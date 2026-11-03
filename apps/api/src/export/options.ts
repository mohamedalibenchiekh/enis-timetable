export interface BlocConfig {
  /** Text of the yellow band, e.g. « BLOC « A » ». */
  title: string;
  /** Regular expressions (case-insensitive) a room name must match to belong to this bloc. */
  patterns: string[];
}

export interface ExportOptions {
  blocs: BlocConfig[];
  /** "BEN RHOUMA Asma" → "B Rhouma Asma" (convention used in the reference Jeudi.docx). */
  abbreviateBen: boolean;
  /** Append "1/15" after the teacher when the session is held once every two weeks. */
  showFrequency: boolean;
  /** Label of the lunch-break column when nothing is scheduled in it. */
  pauseLabel: string;
  /** List rooms of the blocs even if they are empty that day (as in the reference file). */
  includeEmptyRooms: boolean;
}

export const DEFAULT_OPTIONS: ExportOptions = {
  blocs: [
    { title: 'BLOC « A »', patterns: ['^A\\d\\d'] },
    { title: 'BLOC « B »', patterns: ['^B\\d\\d'] },
    { title: 'BLOC « R »', patterns: ['^R\\d\\d', '^Amphi$'] },
  ],
  abbreviateBen: true,
  showFrequency: true,
  pauseLabel: 'Pause',
  includeEmptyRooms: true,
};

export function mergeOptions(partial?: Partial<ExportOptions> | null): ExportOptions {
  return { ...DEFAULT_OPTIONS, ...(partial ?? {}), blocs: partial?.blocs?.length ? partial.blocs : DEFAULT_OPTIONS.blocs };
}
