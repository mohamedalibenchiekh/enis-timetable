import { maskUsername } from './logger';

export interface ClassifiedError {
  userMessage: string;
  technicalDetail: string;
  isVersionMismatch?: boolean;
}

export function classifyStartupError(err: unknown, logsTail?: string): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? '' : '';
  const currentErrorText = `${message}\n${stack}`;

  let userMessage = 'Une erreur inattendue est survenue lors du démarrage.';
  let isVersionMismatch = false;

  // Match against current error first so prior retried attempts in logsTail don't override the real headline
  const matchTarget = (text: string) => {
    if (err && typeof err === 'object' && (err as any).name === 'DatabaseVersionMismatchError') {
      isVersionMismatch = true;
      return message;
    }
    if (err && typeof err === 'object' && (err as any).name === 'DatabaseVersionFileCorruptError') {
      return message;
    }
    if (/port (?:est )?occupé|address already in use|EADDRINUSE/i.test(text)) {
      return 'Le port réseau nécessaire est actuellement occupé par un autre processus.';
    }
    if (/autre exemplaire|instance lock|single-instance/i.test(text)) {
      return 'Un autre exemplaire de l’application est déjà ouvert ou en cours de fermeture.';
    }
    if (/dossier de données est verrouillé|EBUSY|file lock|processus postgres(?:ql)? résiduel/i.test(text)) {
      return 'Le dossier de données est verrouillé ou inaccessible par le système.';
    }
    if (/ENOSPC|espace disque insuffisant|no space left on device|disk full/i.test(text)) {
      return 'Espace disque insuffisant sur le volume pour démarrer la base de données.';
    }
    if (/EACCES|accès refusé|permission denied|droits d’accès refusés/i.test(text)) {
      return 'Droits d’accès refusés pour accéder aux fichiers de données.';
    }
    if (/corrupt|invalide|corrompu/i.test(text)) {
      return 'Le dossier de données ou l’un de ses fichiers semble corrompu ou illisible.';
    }
    return null;
  };

  const matchedFromError = matchTarget(currentErrorText);
  if (matchedFromError) {
    userMessage = matchedFromError;
  } else if (logsTail) {
    // Only look into recent logs if the error itself was generic (e.g. child process exit)
    const recentLogs = logsTail.trim().split('\n').slice(-15).join('\n');
    const matchedFromLogs = matchTarget(recentLogs);
    if (matchedFromLogs) {
      userMessage = matchedFromLogs;
    } else if (/Le serveur s'est arrêté|Le serveur ne répond pas/i.test(message)) {
      userMessage = 'Le serveur interne ne répond pas. Vérifiez les journaux de démarrage pour plus de détails.';
    }
  } else if (/Le serveur s'est arrêté|Le serveur ne répond pas/i.test(message)) {
    userMessage = 'Le serveur interne ne répond pas. Vérifiez les journaux de démarrage pour plus de détails.';
  }

  // Always include the error message along with the log excerpt in technical details
  const logExcerpt = logsTail?.trim() ? logsTail.trim().split('\n').slice(-15).join('\n') : '';
  const technicalDetail = maskUsername(
    logExcerpt && !logExcerpt.includes(message)
      ? `${message}\n\n${logExcerpt}`
      : (logExcerpt || message)
  );

  return {
    userMessage,
    technicalDetail,
    isVersionMismatch,
  };
}
