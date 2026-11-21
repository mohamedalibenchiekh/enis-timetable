import { maskUsername } from './logger';

export interface ClassifiedError {
  userMessage: string;
  technicalDetail: string;
  isVersionMismatch?: boolean;
}

export function classifyStartupError(err: unknown, logsTail?: string): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? '' : '';
  const fullText = `${message}\n${stack}\n${logsTail ?? ''}`;

  let userMessage = 'Une erreur inattendue est survenue lors du démarrage.';
  let isVersionMismatch = false;

  if (err && typeof err === 'object' && (err as any).name === 'DatabaseVersionMismatchError') {
    isVersionMismatch = true;
    userMessage = message;
  } else if (err && typeof err === 'object' && (err as any).name === 'DatabaseVersionFileCorruptError') {
    userMessage = message;
  } else if (/port est occupé|address already in use|EADDRINUSE/i.test(fullText)) {
    userMessage = 'Le port réseau nécessaire est actuellement occupé par un autre processus.';
  } else if (/autre exemplaire|instance lock|single-instance/i.test(message) || /autre exemplaire de l’application est déjà ouvert/i.test(fullText)) {
    userMessage = 'Un autre exemplaire de l’application est déjà ouvert ou en cours de fermeture.';
  } else if (/dossier de données est verrouillé|EBUSY|file lock|processus postgres résiduel/i.test(fullText)) {
    userMessage = 'Le dossier de données est verrouillé ou inaccessible par le système.';
  } else if (/ENOSPC|espace disque insuffisant|no space left on device|disk full/i.test(fullText)) {
    userMessage = 'Espace disque insuffisant sur le volume pour démarrer la base de données.';
  } else if (/EACCES|accès refusé|permission denied|droits d’accès refusés/i.test(fullText)) {
    userMessage = 'Droits d’accès refusés pour accéder aux fichiers de données.';
  } else if (/corrupt|invalide|corrompu/i.test(fullText)) {
    userMessage = 'Le dossier de données ou l’un de ses fichiers semble corrompu ou illisible.';
  } else if (/Le serveur s'est arrêté|Le serveur ne répond pas/i.test(message)) {
    userMessage = 'Le serveur interne ne répond pas. Vérifiez les journaux de démarrage pour plus de détails.';
  }

  const technicalDetail = maskUsername(
    (logsTail && logsTail.trim().length > 0)
      ? logsTail.trim().split('\n').slice(-15).join('\n')
      : message
  );

  return {
    userMessage,
    technicalDetail,
    isVersionMismatch,
  };
}
