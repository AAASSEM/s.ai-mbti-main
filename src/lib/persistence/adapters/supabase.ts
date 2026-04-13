// src/lib/persistence/adapters/supabase.ts
import { supabase } from '../../supabase';
import { StudyDatabase, ParticipantData, EmailData, TrialData, AppErrorData } from '../types';

export class SupabaseAdapter implements StudyDatabase {
  async saveAssessment(participant: ParticipantData, emails: EmailData): Promise<void> {
    // 1. Save participant
    const { error: pErr } = await supabase.from('participants').upsert({
      uuid: participant.uuid,
      academic_year_career_stage: participant.academic_year_career_stage,
      primary_discipline: participant.primary_discipline,
      primary_minor: participant.primary_minor,
      institutional_affiliation: participant.institutional_affiliation || "N/A",
      country_of_origin: participant.country_of_origin || "N/A",
      mbti_assessment_language: participant.mbti_assessment_language,
      took_in_native_language: participant.took_in_native_language,
      mbti_type_core: participant.mbti_type_core,
      mbti_type_full: participant.mbti_type_full,
      overall_persona_fit: participant.overall_persona_fit,
      fit_score_extended: participant.fit_score_extended,
      raw_data: participant
    });
    if (pErr) throw pErr;

    // 2. Save email (PII)
    const { error: eErr } = await supabase.from('master_key_emails').upsert({
      participant_uuid: participant.uuid,
      raw_email: emails.raw_email,
      secondary_contact: emails.secondary_contact
    });
    if (eErr) throw eErr;
  }

  async getParticipantByEmail(email: string): Promise<ParticipantData | null> {
    const { data: eData, error: eErr } = await supabase
      .from('master_key_emails')
      .select('participant_uuid')
      .ilike('raw_email', email)
      .single();
    
    if (eErr || !eData) return null;

    const { data: pData, error: pErr } = await supabase
      .from('participants')
      .select('*')
      .eq('uuid', eData.participant_uuid)
      .single();
    
    if (pErr || !pData) return null;

    return pData.raw_data as ParticipantData;
  }

  async getAllAssessments(): Promise<any[]> {
    const { data, error } = await supabase.from('participants').select('*');
    if (error) throw error;
    return data.map(d => ({ ...d.raw_data, ...d })); // Merge SQL columns over JSON if any
  }

  async getAllEmails(): Promise<Record<string, any>> {
    const { data, error } = await supabase.from('master_key_emails').select('*');
    if (error) throw error;
    return data.reduce((acc: any, d) => {
      acc[d.participant_uuid] = d;
      return acc;
    }, {});
  }

  async loadContent(topicId: string, persona: string): Promise<any> {
    const { data: agnostic, error: aErr } = await supabase
      .from('content_cache')
      .select('*')
      .eq('topic_id', topicId)
      .eq('target_persona', 'AGNOSTIC')
      .single();
    
    const { data: curated, error: cErr } = await supabase
      .from('content_cache')
      .select('*')
      .eq('topic_id', topicId)
      .eq('target_persona', persona)
      .single();

    return {
      agnostic: agnostic || null,
      curated: curated || agnostic || null
    };
  }

  async saveTrial(trial: TrialData): Promise<void> {
    const { error } = await supabase.from('study_trials').insert({
      trial_id: trial.trial_id,
      participant_uuid: trial.participant_uuid,
      topic_id: trial.topic_id,
      left_is_style_x: trial.left_is_style_x,
      ratings_a: trial.ratings_a,
      ratings_b: trial.ratings_b,
      overall_preference: trial.overall_preference,
      prior_exposure: trial.prior_exposure,
      qualitative_reason: trial.qualitative_reason,
      ai_familiarity: trial.ai_familiarity,
      fatigue_stress: trial.fatigue_stress,
      curated_selected_overall: trial.curated_selected_overall,
      is_test: trial.is_test
    });
    if (error) throw error;
  }

  async checkIfCompleted(participantUuid: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('study_trials')
      .select('trial_id')
      .eq('participant_uuid', participantUuid)
      .limit(1);
    
    return !!data && data.length > 0;
  }

  async getAllTrials(): Promise<any[]> {
    const { data, error } = await supabase.from('study_trials').select('*');
    if (error) throw error;
    return data;
  }

  async seedContent(items: any[]): Promise<void> {
    const formatted = items.map(item => ({
      id: `${item.topic_id}_${item.target_persona}`,
      topic_id: item.topic_id,
      target_persona: item.target_persona,
      content_body: item.content_body
    }));
    
    const { error } = await supabase.from('content_cache').upsert(formatted);
    if (error) throw error;
  }

  async logError(error: AppErrorData): Promise<void> {
    await supabase.from('app_errors').insert({
      short_id: error.short_id,
      action: error.action,
      message: error.message,
      stack: error.stack,
      context: error.context,
      user_agent: error.userAgent,
      url: error.url
    });
  }

  async getAllErrors(): Promise<any[]> {
    const { data, error } = await supabase.from('app_errors').select('*');
    if (error) throw error;
    return data;
  }

  async getSettings(): Promise<any> {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'config').single();
    return data?.value || null;
  }

  async saveSettings(settings: any): Promise<void> {
    await supabase.from('app_settings').upsert({ key: 'config', value: settings });
  }
}
