// src/lib/persistence/types.ts

export interface ParticipantData {
  uuid: string;
  consent_timestamp: string;
  academic_year_career_stage: string;
  primary_discipline: string;
  primary_minor?: string;
  institutional_affiliation: string;
  country_of_origin: string;
  mbti_assessment_language: string;
  took_in_native_language: boolean;
  mbti_type_core: string;
  mbti_type_full: string;
  overall_persona_fit: number;
  fit_score_extended: number;
  [key: string]: any;
}

export interface EmailData {
  participant_uuid: string;
  raw_email: string;
  secondary_contact?: string;
}

export interface TrialData {
  trial_id: string;
  participant_uuid: string;
  topic_id: string;
  timestamp: any;
  left_is_style_x: boolean;
  ratings_a: any;
  ratings_b: any;
  overall_preference: string;
  prior_exposure: string;
  qualitative_reason: string;
  ai_familiarity: number;
  fatigue_stress: number;
  curated_selected_overall: boolean;
  is_test: boolean;
}

export interface AppErrorData {
  short_id: string;
  action: string;
  message: string;
  stack?: string;
  context: any;
  timestamp: any;
  userAgent: string;
  url: string;
}

export interface StudyDatabase {
  // Assessment (Phase 1)
  saveAssessment(participant: ParticipantData, emails: EmailData): Promise<void>;
  getParticipantByEmail(email: string): Promise<ParticipantData | null>;
  getAllAssessments(): Promise<any[]>;
  getAllEmails(): Promise<Record<string, any>>;

  // Study (Phase 2)
  loadContent(topicId: string, persona: string): Promise<any>;
  saveTrial(trial: TrialData): Promise<void>;
  checkIfCompleted(participantUuid: string): Promise<boolean>;
  getAllTrials(): Promise<any[]>;
  seedContent(items: any[]): Promise<void>;

  // System
  logError(error: AppErrorData): Promise<void>;
  getAllErrors(): Promise<any[]>;
  getSettings(): Promise<any>;
  saveSettings(settings: any): Promise<void>;
}
