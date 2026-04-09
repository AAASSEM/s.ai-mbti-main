// src/lib/persistence/adapters/firebase.ts
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  setDoc, 
  addDoc, 
  getDoc, 
  writeBatch,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../../firebase';
import { StudyDatabase, ParticipantData, EmailData, TrialData, AppErrorData } from '../types';

export class FirebaseAdapter implements StudyDatabase {
  async saveAssessment(participant: ParticipantData, emails: EmailData): Promise<void> {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users_phase1', participant.uuid), participant);
    batch.set(doc(db, 'master_key_emails', participant.uuid), {
      participant_uuid: emails.participant_uuid,
      raw_email: emails.raw_email,
      secondary_contact: emails.secondary_contact || 'N/A'
    });
    await batch.commit();
  }

  async getParticipantByEmail(email: string): Promise<ParticipantData | null> {
    const q = query(collection(db, 'master_key_emails'), where('raw_email', '==', email));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    
    const uuid = snap.docs[0].id;
    const uSnap = await getDoc(doc(db, 'users_phase1', uuid));
    return uSnap.exists() ? (uSnap.data() as ParticipantData) : null;
  }

  async getAllAssessments(): Promise<any[]> {
    const snap = await getDocs(collection(db, 'users_phase1'));
    return snap.docs.map(d => d.data());
  }

  async getAllEmails(): Promise<Record<string, any>> {
    const snap = await getDocs(collection(db, 'master_key_emails'));
    return snap.docs.reduce((acc: any, d) => {
      acc[d.id] = d.data();
      return acc;
    }, {});
  }

  async loadContent(topicId: string, persona: string): Promise<any> {
    const qAgnostic = query(collection(db, 'content_cache'), 
      where('topic_id', '==', topicId), where('target_persona', '==', 'AGNOSTIC'));
    const qCurated = query(collection(db, 'content_cache'), 
      where('topic_id', '==', topicId), where('target_persona', '==', persona));
    
    const [snapA, snapC] = await Promise.all([getDocs(qAgnostic), getDocs(qCurated)]);
    return {
      agnostic: snapA.docs[0]?.data(),
      curated: snapC.docs[0]?.data()
    };
  }

  async saveTrial(trial: TrialData): Promise<void> {
    await setDoc(doc(db, 'phase2_trials', trial.trial_id), {
      ...trial,
      timestamp: Timestamp.now()
    });
  }

  async checkIfCompleted(participantUuid: string): Promise<boolean> {
    const q = query(collection(db, 'phase2_trials'), where('participant_uuid', '==', participantUuid));
    const snap = await getDocs(q);
    return !snap.empty;
  }

  async getAllTrials(): Promise<any[]> {
    const snap = await getDocs(collection(db, 'phase2_trials'));
    return snap.docs.map(d => d.data());
  }

  async seedContent(items: any[]): Promise<void> {
    const batch = writeBatch(db);
    items.forEach(item => {
      const docId = `${item.topic_id}_${item.target_persona}`;
      batch.set(doc(db, 'content_cache', docId), item);
    });
    await batch.commit();
  }

  async logError(error: AppErrorData): Promise<void> {
    await addDoc(collection(db, 'app_errors'), {
      ...error,
      timestamp: Timestamp.now()
    });
  }

  async getAllErrors(): Promise<any[]> {
    const snap = await getDocs(collection(db, 'app_errors'));
    return snap.docs.map(d => d.data());
  }

  async getSettings(): Promise<any> {
    const snap = await getDoc(doc(db, 'app_settings', 'config'));
    return snap.exists() ? snap.data() : null;
  }

  async saveSettings(settings: any): Promise<void> {
    await setDoc(doc(db, 'app_settings', 'config'), settings);
  }
}
