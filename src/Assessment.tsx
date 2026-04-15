import React, { useState, useEffect } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { persistence } from './lib/persistence';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import { Label } from './components/ui/Label';
import { Select } from './components/ui/Select';
import { Textarea } from './components/ui/Textarea';
import { Checkbox } from './components/ui/Checkbox';
import { Radio } from './components/ui/Radio';
import { Plus, Trash2, Earth } from 'lucide-react';

const formSchema = z.object({
  // Step 1
  encrypted_email: z.string().email("Please enter a valid university or primary email address."),
  secondary_contact: z.string().email("Please enter a valid personal email address.").optional().or(z.literal('')),
  voluntariness_check: z.boolean().refine(val => val === true, { message: "You must check this box to indicate your consent to participate." }),

  // Step 2
  participant_age: z.number().min(18, "Participants must be at least 18 years old.").max(99, "Please enter a valid age."),
  institutional_affiliation: z.string().min(1, "Please select your institutional affiliation."),
  institutional_affiliation_other: z.string().optional(),
  country_of_origin: z.string().min(1, "Please select your country of origin."),
  country_of_origin_other: z.string().optional(),
  current_country_of_residence: z.string().min(1, "Please select your current country of residence."),
  current_country_of_residence_other: z.string().optional(),
  cultural_ethnic_identification: z.string().optional(),

  // Step 3
  mother_tongue_1: z.string().min(1, "Please specify your mother tongue."),
  english_proficiency_level: z.string().min(1, "Please select your English proficiency level."),
  years_studying_in_english: z.number().min(0, "Years cannot be negative."),
  participant_status: z.string().min(1, "Please select your current status."),
  academic_year_career_stage: z.string().min(1, "Please specify your academic year or career stage."),
  primary_discipline: z.string().min(1, "Please enter your primary discipline or major."),
  primary_minor: z.string().optional(),
  previous_degrees: z.array(z.object({
    degree: z.string().min(1, "Please specify the degree/certificate type."),
    discipline: z.string().min(1, "Please specify the discipline/major."),
    minor: z.string().optional()
  })).default([]),

  // Step 4
  mbti_assessment_language: z.string().min(1, "Please select the language you used for the assessment."),
  took_in_native_language: z.string().min(1, "Please specify if this is your native language."),
  mbti_core: z.string().length(4, "Please select your 4-letter personality type."),
  mbti_modifier: z.string().min(1, "Please select your modifier (Assertive, Turbulent, or Not sure)."),
  dim_val_e_i: z.coerce.number().min(1, "Please rate how accurately the Extraversion vs. Introversion dimension describes you."),
  dim_val_s_n: z.coerce.number().min(1, "Please rate how accurately the Sensing vs. Intuition dimension describes you."),
  dim_val_t_f: z.coerce.number().min(1, "Please rate how accurately the Thinking vs. Feeling dimension describes you."),
  dim_val_j_p: z.coerce.number().min(1, "Please rate how accurately the Judging vs. Perceiving dimension describes you."),
  dim_val_a_t: z.coerce.number().optional().nullable(),
  overall_persona_fit: z.coerce.number().min(1, "Please provide an overall accuracy rating for your results."),
  qualitative_alignment: z.string().optional(),
  qualitative_divergence: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.years_studying_in_english > data.participant_age) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Years studying English cannot exceed your actual age.",
      path: ["years_studying_in_english"]
    });
  }
  if (['Other Academic', 'Corporate Partner'].includes(data.institutional_affiliation) && !data.institutional_affiliation_other?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Please specify the name of your institution or company.",
      path: ["institutional_affiliation_other"]
    });
  }
  if (data.country_of_origin === 'OTHER' && !data.country_of_origin_other?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Please specify your country of origin.",
      path: ["country_of_origin_other"]
    });
  }
  if (data.current_country_of_residence === 'OTHER' && !data.current_country_of_residence_other?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Please specify your current country of residence.",
      path: ["current_country_of_residence_other"]
    });
  }
  // Only validate 5th dimension if a modifier was actually selected and it's not UNKNOWN
  if (data.mbti_modifier && data.mbti_modifier !== 'UNKNOWN' && data.mbti_modifier !== 'NOT_SURE' && !data.dim_val_a_t) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Please provide a rating for the Assertive vs. Turbulent dimension.",
      path: ["dim_val_a_t"]
    });
  }
});

type FormData = z.infer<typeof formSchema>;

const STEPS = 4;

const hashEmail = async (email: string) => {
  const msgBuffer = new TextEncoder().encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const STORAGE_KEY = 'assessment_draft';
const STEP_KEY = 'assessment_step';

const loadSavedDraft = (): Partial<FormData> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};

export default function AssessmentForm() {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = "MBTI Research Study";
  }, []);

  const savedStep = parseInt(localStorage.getItem(STEP_KEY) || '1', 10);
  const [step, setStep] = useState(savedStep >= 1 && savedStep <= 4 ? savedStep : 1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requireFifthDim, setRequireFifthDim] = useState(true);

  React.useEffect(() => {
    // Fetch admin settings
    getDoc(doc(db, 'app_settings', 'config')).then(snap => {
      if (snap.exists()) {
        setRequireFifthDim(snap.data().require_fifth_dimension);
      }
    }).catch(console.error);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        navigate('/admin');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const saved = loadSavedDraft();
  const { register, handleSubmit, control, formState: { errors, submitCount }, trigger, watch, clearErrors, setValue } = useForm<FormData>({
    resolver: zodResolver(formSchema) as any,
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
    defaultValues: {
      voluntariness_check: false,
      previous_degrees: [],
      mbti_assessment_language: '',
      took_in_native_language: '',
      mbti_core: '',
      mbti_modifier: '',
      dim_val_e_i: 0,
      dim_val_s_n: 0,
      dim_val_t_f: 0,
      dim_val_j_p: 0,
      dim_val_a_t: 0,
      overall_persona_fit: 0,
      ...saved,
    }
  });

  // Auto-save form data and step to localStorage
  const allFields = watch();
  useEffect(() => {
    if (!isSubmitted) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allFields));
      localStorage.setItem(STEP_KEY, step.toString());
    }
  }, [allFields, step, isSubmitted]);

  const { fields: degreeFields, append: appendDegree, remove: removeDegree } = useFieldArray({
    control,
    name: "previous_degrees"
  });

  const participantStatus = watch('participant_status');
  const affiliation = watch('institutional_affiliation');
  const countryOfOrigin = watch('country_of_origin');
  const currentCountryOfResidence = watch('current_country_of_residence');
  const mbtiModifier = watch('mbti_modifier');

  const [showErrors, setShowErrors] = useState(false);

  const handleNext = async () => {
    let fieldsToValidate: any[] = [];
    if (step === 1) {
      fieldsToValidate = ['encrypted_email', 'secondary_contact', 'voluntariness_check'];
    } else if (step === 2) {
      fieldsToValidate = ['participant_age', 'institutional_affiliation', 'institutional_affiliation_other', 'country_of_origin', 'country_of_origin_other', 'current_country_of_residence', 'current_country_of_residence_other', 'cultural_ethnic_identification'];
    } else if (step === 3) {
      fieldsToValidate = ['mother_tongue_1', 'english_proficiency_level', 'years_studying_in_english', 'participant_status', 'academic_year_career_stage', 'primary_discipline', 'primary_minor', 'previous_degrees'];
    } else if (step === 4) {
      fieldsToValidate = ['mbti_assessment_language', 'took_in_native_language', 'mbti_core', 'mbti_modifier', 'dim_val_e_i', 'dim_val_s_n', 'dim_val_t_f', 'dim_val_j_p', 'overall_persona_fit', 'qualitative_alignment', 'qualitative_divergence'];
      if (mbtiModifier !== 'UNKNOWN' && mbtiModifier !== 'NOT_SURE') {
        fieldsToValidate.push('dim_val_a_t');
      }
    }

    setShowErrors(true);
    const isStepValid = await trigger(fieldsToValidate as any);
    if (isStepValid) {
      // Hide errors and clear all future-step errors during transition
      setShowErrors(false);
      clearErrors();
      setTimeout(() => {
        clearErrors();
      }, 50);
      setStep(prev => prev + 1);
      window.scrollTo(0, 0);
    }
  };

  const handlePrev = () => {
    setShowErrors(false);
    clearErrors();
    setStep(prev => prev - 1);
    window.scrollTo(0, 0);
  };

  const onError = (errors: any) => {
    console.log("Validation Errors:", errors);
    setShowErrors(true);
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      const firstError = errorKeys[0];
      // Try to find by name (for radios/selects) or by ID
      const element = document.getElementsByName(firstError)[0] || document.getElementById(firstError);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    setError(null);
    try {
      // 1. Generate UUID and Timestamp
      const participant_uuid = uuidv4();
      const consent_timestamp = new Date().toISOString();

      // 3. Calculate Backend Computed Variables
      const mbti_type_full = (data.mbti_modifier === 'UNKNOWN' || data.mbti_modifier === 'NOT_SURE') ? data.mbti_core : `${data.mbti_core}-${data.mbti_modifier}`;
      const mbti_type_core = data.mbti_core;

      const fit_score_core_only = (data.dim_val_e_i + data.dim_val_s_n + data.dim_val_t_f + data.dim_val_j_p + data.overall_persona_fit) / 5;
      let fit_score_extended = fit_score_core_only;
      if (data.mbti_modifier !== 'UNKNOWN' && data.mbti_modifier !== 'NOT_SURE' && data.dim_val_a_t) {
        fit_score_extended = (data.dim_val_e_i + data.dim_val_s_n + data.dim_val_t_f + data.dim_val_j_p + data.dim_val_a_t + data.overall_persona_fit) / 6;
      }

      const hashed_email = await hashEmail(data.encrypted_email);

      // 4. Save to Database using Persistence Layer
      try {
        await persistence.saveAssessment({
          uuid: participant_uuid,
          consent_timestamp,
          academic_year_career_stage: data.academic_year_career_stage,
          primary_discipline: data.primary_discipline,
          primary_minor: data.primary_minor || null,
          institutional_affiliation: data.institutional_affiliation || data.institutional_affiliation_other,
          country_of_origin: data.country_of_origin || data.country_of_origin_other,
          mbti_assessment_language: data.mbti_assessment_language,
          took_in_native_language: data.took_in_native_language === 'Yes',
          mbti_type_core: mbti_type_core,
          mbti_type_full: mbti_type_full,
          overall_persona_fit: parseInt(data.overall_persona_fit.toString()),
          fit_score_extended: fit_score_extended,
          // Extra analytical fields
          participant_age: data.participant_age,
          current_country_of_residence: data.current_country_of_residence || data.current_country_of_residence_other,
          cultural_ethnic_identification: data.cultural_ethnic_identification || null,
          mother_tongue_1: data.mother_tongue_1,
          english_proficiency_level: data.english_proficiency_level,
          years_studying_in_english: data.years_studying_in_english,
          participant_status: data.participant_status,
          fit_score_core_only: fit_score_core_only,
          dim_val_e_i: parseInt(data.dim_val_e_i.toString()),
          dim_val_s_n: parseInt(data.dim_val_s_n.toString()),
          dim_val_t_f: parseInt(data.dim_val_t_f.toString()),
          dim_val_j_p: parseInt(data.dim_val_j_p.toString()),
          dim_val_a_t: data.dim_val_a_t ? parseInt(data.dim_val_a_t.toString()) : null,
          qualitative_alignment: data.qualitative_alignment || null,
          qualitative_divergence: data.qualitative_divergence || null,
          previous_degrees: data.previous_degrees || [],
          voluntariness_check: data.voluntariness_check
        }, {
          participant_uuid,
          raw_email: data.encrypted_email.trim().toLowerCase(),
          secondary_contact: data.secondary_contact?.trim().toLowerCase() || null
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'assessment_submission');
      }

      // Clear saved draft on successful submission
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STEP_KEY);
      setIsSubmitted(true);
    } catch (err: any) {
      console.error(err);
      setError("An error occurred while submitting your responses. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full bg-white p-8 rounded-xl shadow-sm border border-gray-100 text-center">
          <h2 className="text-2xl font-semibold mb-4 text-gray-900">Thank you for completing the survey!</h2>
          <p className="text-gray-600 mb-6 leading-relaxed">
            Your responses have been successfully recorded. Your participation is vital to our ongoing research into human behavior and development. Further information regarding the specific findings of this study will be shared once all data collection has concluded.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-900 px-6 py-8 sm:p-10 text-white text-center">
          <h1 className="text-2xl font-semibold">Holistic Personality & Development Assessment</h1>
        </div>

        <div className="px-6 py-8 sm:p-10">
          {/* Progress Bar */}
          <div className="mb-8">
            <div className="flex justify-between text-sm font-medium text-gray-500 mb-2">
              <span>Step {step} of {STEPS}</span>
              <span>{Math.round((step / STEPS) * 100)}% Completed</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-gray-900 h-2 rounded-full transition-all duration-300" style={{ width: `${(step / STEPS) * 100}%` }}></div>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md">
              {error}
            </div>
          )}

          <form
            onSubmit={handleSubmit(onSubmit, onError)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') e.preventDefault(); }}
            className="space-y-8"
          >

            {/* STEP 1 */}
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white border border-gray-200 p-6 rounded-md shadow-sm mb-8 text-sm text-gray-700 space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900">Informed Consent & Study Information</h3>
                  <p>Welcome to our research study. Before you begin, please review the following information:</p>
                  <ul className="list-disc list-inside space-y-2 ml-2">
                    <li><strong>Time Commitment:</strong> This assessment will take approximately 15-20 minutes to complete (including a brief external personality test).</li>
                    <li><strong>Data Privacy & Retention:</strong> Your responses are strictly confidential. Data is stored securely and will <strong>never</strong> be shared with third parties. Your email is encrypted and hashed to protect your identity.</li>
                    <li><strong>Feedback & Results:</strong> Aggregate findings and personal feedback will be provided to participants at the end of the current semester, once all data has been collected and analyzed.</li>
                    <li><strong>Voluntary Participation:</strong> Your participation is completely voluntary. You may choose to withdraw at any time without penalty.</li>
                  </ul>
                </div>
                <div>
                  <h2 className="text-xl font-medium text-gray-900 mb-2">IRB Consent & Logistics</h2>
                  <p className="text-gray-600 text-sm leading-relaxed mb-6">
                    This is a comprehensive assessment designed to help you understand your unique personality, capitalize on your natural strengths, and identify areas for personal and professional growth.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="encrypted_email">University/Primary Email <span className="text-red-500">*</span></Label>
                    <Input id="encrypted_email" type="email" {...register('encrypted_email')} className="mt-1" />
                    {showErrors && errors.encrypted_email && <p className="text-red-500 text-sm mt-1">{errors.encrypted_email.message}</p>}
                  </div>

                  <div>
                    <Label htmlFor="secondary_contact">Secondary/Personal Email (Optional)</Label>
                    <p className="text-xs text-gray-500 mb-1">Please provide a secondary/personal email address. This ensures we can send you your results and the final study debriefing in the event you graduate or lose access to your university account.</p>
                    <Input id="secondary_contact" type="email" {...register('secondary_contact')} />
                    {showErrors && errors.secondary_contact && <p className="text-red-500 text-sm mt-1">{errors.secondary_contact.message}</p>}
                  </div>

                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-start">
                      <div className="flex items-center h-5">
                        <Controller
                          name="voluntariness_check"
                          control={control}
                          render={({ field }) => (
                            <Checkbox
                              id="voluntariness_check"
                              checked={field.value}
                              onChange={(e) => field.onChange(e.target.checked)}
                            />
                          )}
                        />
                      </div>
                      <div className="ml-3 text-sm">
                        <Label htmlFor="voluntariness_check" className="font-normal text-gray-700">
                          I understand that my participation is entirely voluntary, my data will be anonymized, and my choice to participate will not impact my grades, academic standing, or employment. <span className="text-red-500">*</span>
                        </Label>
                        {showErrors && errors.voluntariness_check && <p className="text-red-500 text-sm mt-1">{errors.voluntariness_check.message}</p>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h2 className="text-xl font-medium text-gray-900 mb-6">Demographics & Cultural Context</h2>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="participant_age">Age <span className="text-red-500">*</span></Label>
                    <Input id="participant_age" type="number" {...register('participant_age', { valueAsNumber: true })} className="mt-1 max-w-[150px]" />
                    {showErrors && errors.participant_age && <p className="text-red-500 text-sm mt-1">{errors.participant_age.message}</p>}
                  </div>

                  <div>
                    <Label htmlFor="institutional_affiliation">Institutional Affiliation <span className="text-red-500">*</span></Label>
                    <Select id="institutional_affiliation" {...register('institutional_affiliation')} className="mt-1">
                      <option value="">Select an affiliation</option>
                      <option value="RIT Dubai">RIT Dubai</option>
                      <option value="RIT New York">RIT New York</option>
                      <option value="RIT Croatia">RIT Croatia</option>
                      <option value="RIT China">RIT China</option>
                      <option value="Suez Canal University">Suez Canal University</option>
                      <option value="Other Academic">Other Academic</option>
                      <option value="Corporate Partner">Corporate Partner</option>
                    </Select>
                    {showErrors && errors.institutional_affiliation && <p className="text-red-500 text-sm mt-1">{errors.institutional_affiliation.message}</p>}

                    {['Other Academic', 'Corporate Partner'].includes(affiliation) && (
                      <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                        <Label htmlFor="institutional_affiliation_other">Please specify <span className="text-red-500">*</span></Label>
                        <Input id="institutional_affiliation_other" {...register('institutional_affiliation_other')} className="mt-1" placeholder="Enter institution or company name" />
                        {showErrors && errors.institutional_affiliation_other && <p className="text-red-500 text-sm mt-1">{errors.institutional_affiliation_other.message}</p>}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="country_of_origin">Country of Origin <span className="text-red-500">*</span></Label>
                      <Select id="country_of_origin" {...register('country_of_origin')} className="mt-1">
                        <option value="">Select a country</option>
                        <option value="US">United States</option>
                        <option value="AE">United Arab Emirates</option>
                        <option value="EG">Egypt</option>
                        <option value="HR">Croatia</option>
                        <option value="CN">China</option>
                        <option value="IN">India</option>
                        <option value="GB">United Kingdom</option>
                        <option value="OTHER">Other</option>
                      </Select>
                      {showErrors && errors.country_of_origin && <p className="text-red-500 text-sm mt-1">{errors.country_of_origin.message}</p>}

                      {countryOfOrigin === 'OTHER' && (
                        <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                          <Label htmlFor="country_of_origin_other">Please specify <span className="text-red-500">*</span></Label>
                          <Input id="country_of_origin_other" {...register('country_of_origin_other')} className="mt-1" placeholder="Enter country name" />
                          {showErrors && errors.country_of_origin_other && <p className="text-red-500 text-sm mt-1">{errors.country_of_origin_other.message}</p>}
                        </div>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="current_country_of_residence">Current Country of Residence <span className="text-red-500">*</span></Label>
                      <Select id="current_country_of_residence" {...register('current_country_of_residence')} className="mt-1">
                        <option value="">Select a country</option>
                        <option value="US">United States</option>
                        <option value="AE">United Arab Emirates</option>
                        <option value="EG">Egypt</option>
                        <option value="HR">Croatia</option>
                        <option value="CN">China</option>
                        <option value="IN">India</option>
                        <option value="GB">United Kingdom</option>
                        <option value="OTHER">Other</option>
                      </Select>
                      {showErrors && errors.current_country_of_residence && <p className="text-red-500 text-sm mt-1">{errors.current_country_of_residence.message}</p>}

                      {currentCountryOfResidence === 'OTHER' && (
                        <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                          <Label htmlFor="current_country_of_residence_other">Please specify <span className="text-red-500">*</span></Label>
                          <Input id="current_country_of_residence_other" {...register('current_country_of_residence_other')} className="mt-1" placeholder="Enter country name" />
                          {showErrors && errors.current_country_of_residence_other && <p className="text-red-500 text-sm mt-1">{errors.current_country_of_residence_other.message}</p>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="cultural_ethnic_identification">Cultural/Ethnic Identification (Optional)</Label>
                    <Input id="cultural_ethnic_identification" placeholder="e.g., Arab, Hispanic, Prefer not to say" {...register('cultural_ethnic_identification')} className="mt-1" />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h2 className="text-xl font-medium text-gray-900 mb-6">Linguistic & Academic Profile</h2>
                </div>

                <div className="space-y-6">
                  <div>
                    <Label htmlFor="mother_tongue_1">Mother Tongue <span className="text-red-500">*</span></Label>
                    <Input id="mother_tongue_1" {...register('mother_tongue_1')} className="mt-1" />
                    {showErrors && errors.mother_tongue_1 && <p className="text-red-500 text-sm mt-1">{errors.mother_tongue_1.message}</p>}
                  </div>

                  <div>
                    <Label className="mb-2 block">English Proficiency Level <span className="text-red-500">*</span></Label>
                    <div className="space-y-2">
                      {['Native', 'Fluent/Bilingual (C1/C2)', 'Professional/Academic (B2)', 'Intermediate (B1)'].map((level) => (
                        <div key={level} className="flex items-center">
                          <Radio
                            id={`prof_${level}`}
                            value={level}
                            {...register('english_proficiency_level')}
                          />
                          <Label htmlFor={`prof_${level}`} className="ml-2 font-normal">{level}</Label>
                        </div>
                      ))}
                    </div>
                    {showErrors && errors.english_proficiency_level && <p className="text-red-500 text-sm mt-1">{errors.english_proficiency_level.message}</p>}
                  </div>

                  <div>
                    <Label htmlFor="years_studying_in_english">Years Studying in English <span className="text-red-500">*</span></Label>
                    <Input id="years_studying_in_english" type="number" {...register('years_studying_in_english', { valueAsNumber: true })} className="mt-1 max-w-[150px]" />
                    {showErrors && errors.years_studying_in_english && <p className="text-red-500 text-sm mt-1">{errors.years_studying_in_english.message}</p>}
                  </div>

                  <div>
                    <Label className="mb-2 block">Participant Status <span className="text-red-500">*</span></Label>
                    <div className="space-y-2">
                      {['Undergraduate', 'Graduate', 'Working Professional'].map((status) => (
                        <div key={status} className="flex items-center">
                          <Radio
                            id={`status_${status}`}
                            value={status}
                            {...register('participant_status')}
                          />
                          <Label htmlFor={`status_${status}`} className="ml-2 font-normal">{status}</Label>
                        </div>
                      ))}
                    </div>
                    {showErrors && errors.participant_status && <p className="text-red-500 text-sm mt-1">{errors.participant_status.message}</p>}
                  </div>

                  {participantStatus === 'Undergraduate' && (
                    <div>
                      <Label htmlFor="academic_year_career_stage">Current Year of Study <span className="text-red-500">*</span></Label>
                      <Select id="academic_year_career_stage" {...register('academic_year_career_stage')} className="mt-1">
                        <option value="">Select year</option>
                        <option value="1st Year">1st Year</option>
                        <option value="2nd Year">2nd Year</option>
                        <option value="3rd Year">3rd Year</option>
                        <option value="4th Year">4th Year</option>
                        <option value="5th Year">5th Year</option>
                        <option value="6th+ Year">6th+ Year</option>
                      </Select>
                      {showErrors && errors.academic_year_career_stage && <p className="text-red-500 text-sm mt-1">{errors.academic_year_career_stage.message}</p>}
                    </div>
                  )}
                  {participantStatus === 'Graduate' && (
                    <div>
                      <Label htmlFor="academic_year_career_stage">Years in Graduate Program <span className="text-red-500">*</span></Label>
                      <Input id="academic_year_career_stage" type="number" min="0" max="20" placeholder="e.g., 2" {...register('academic_year_career_stage')} className="mt-1 max-w-[150px]" />
                      {showErrors && errors.academic_year_career_stage && <p className="text-red-500 text-sm mt-1">{errors.academic_year_career_stage.message}</p>}
                    </div>
                  )}
                  {participantStatus === 'Working Professional' && (
                    <div>
                      <Label htmlFor="academic_year_career_stage">Years of Professional Experience <span className="text-red-500">*</span></Label>
                      <Input id="academic_year_career_stage" type="number" min="0" max="60" placeholder="e.g., 5" {...register('academic_year_career_stage')} className="mt-1 max-w-[150px]" />
                      {showErrors && errors.academic_year_career_stage && <p className="text-red-500 text-sm mt-1">{errors.academic_year_career_stage.message}</p>}
                    </div>
                  )}

                  <div>
                    <Label htmlFor="primary_discipline">Primary Discipline / Major <span className="text-red-500">*</span></Label>
                    <Input id="primary_discipline" {...register('primary_discipline')} className="mt-1" placeholder="e.g., Mathematics, Computer Science" />
                    {showErrors && errors.primary_discipline && <p className="text-red-500 text-sm mt-1">{errors.primary_discipline.message}</p>}
                  </div>

                  <div>
                    <Label htmlFor="primary_minor">Minor (Optional)</Label>
                    <Input id="primary_minor" {...register('primary_minor')} className="mt-1" placeholder="e.g., Mathematics, Psychology" />
                  </div>

                  <div className="pt-6 border-t border-gray-100">
                    <div className="flex justify-between items-center mb-4">
                      <div>
                        <h3 className="font-medium text-gray-900">Previous Degrees & Certificates</h3>
                        <p className="text-sm text-gray-500">Please list any degrees or professional certificates you have already completed.</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => appendDegree({ degree: '', discipline: '', minor: '' })}
                        className="flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" /> Add Degree
                      </Button>
                    </div>

                    {degreeFields.length === 0 ? (
                      <div className="text-center p-4 border border-dashed border-gray-300 rounded-md text-gray-500 text-sm">
                        No previous degrees added. Click "Add Degree" if you have completed any.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {degreeFields.map((field, index) => (
                          <div key={field.id} className="flex gap-4 items-start bg-gray-50 p-4 rounded-md border border-gray-100">
                            <div className="flex-1 space-y-4">
                              <div>
                                <Label htmlFor={`previous_degrees.${index}.degree`}>Degree / Certificate Type <span className="text-red-500">*</span></Label>
                                <Select
                                  id={`previous_degrees.${index}.degree`}
                                  {...register(`previous_degrees.${index}.degree` as const)}
                                  className="mt-1"
                                >
                                  <option value="">Select type</option>
                                  <option value="Bachelor's Degree">Bachelor's Degree</option>
                                  <option value="Master's Degree">Master's Degree</option>
                                  <option value="MBA">MBA</option>
                                  <option value="PhD / Doctorate">PhD / Doctorate</option>
                                  <option value="Professional Certification">Professional Certification</option>
                                  <option value="Associate Degree">Associate Degree</option>
                                  <option value="Diploma">Diploma</option>
                                  <option value="Other">Other</option>
                                </Select>
                                {errors.previous_degrees?.[index]?.degree && (
                                  <p className="text-red-500 text-sm mt-1">{errors.previous_degrees[index]?.degree?.message}</p>
                                )}
                              </div>
                              <div>
                                <Label htmlFor={`previous_degrees.${index}.discipline`}>Major / Discipline <span className="text-red-500">*</span></Label>
                                <Input
                                  id={`previous_degrees.${index}.discipline`}
                                  placeholder="e.g., Psychology, Computer Science"
                                  {...register(`previous_degrees.${index}.discipline` as const)}
                                  className="mt-1"
                                />
                                {errors.previous_degrees?.[index]?.discipline && (
                                  <p className="text-red-500 text-sm mt-1">{errors.previous_degrees[index]?.discipline?.message}</p>
                                )}
                              </div>
                              <div>
                                <Label htmlFor={`previous_degrees.${index}.minor`}>Minor (Optional)</Label>
                                <Input
                                  id={`previous_degrees.${index}.minor`}
                                  placeholder="e.g., Psychology, Business"
                                  {...register(`previous_degrees.${index}.minor` as const)}
                                  className="mt-1"
                                />
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => removeDegree(index)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 mt-6"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4 */}
            {step === 4 && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h2 className="text-xl font-medium text-gray-900 mb-2">Personality Assessment Input</h2>
                  <div className="bg-blue-50 border border-blue-100 p-4 rounded-md text-sm text-blue-800 mb-6">
                    <p className="font-medium mb-1">Instructions:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Please navigate to <a href="https://www.16personalities.com/free-personality-test" target="_blank" rel="noopener noreferrer" className="underline font-semibold">16Personalities.com</a> in a new tab.</li>
                      <li>Choose your preferred language through the <Earth className="inline-block w-4 h-4 mb-1 mx-1" /> (earth icon)</li>
                      <li>If not already taken, take the free personality test (takes about 10-15 minutes).</li>
                      <li>Return here and enter your result.</li>
                    </ol>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="sm:col-span-2">
                    <Label htmlFor="mbti_assessment_language">Language used for the 16Personalities test <span className="text-red-500">*</span></Label>
                    <Select id="mbti_assessment_language" {...register('mbti_assessment_language')} className="mt-1">
                      <option value="">Select language</option>
                      <option value="English">English</option>
                      <option value="Arabic">Arabic (العربية)</option>
                      <option value="Spanish">Spanish (Español)</option>
                      <option value="French">French (Français)</option>
                      <option value="German">German (Deutsch)</option>
                      <option value="Italian">Italian (Italiano)</option>
                      <option value="Portuguese">Portuguese (Português)</option>
                      <option value="Russian">Russian (Русский)</option>
                      <option value="Chinese (Simplified)">Chinese (Simplified) (简体中文)</option>
                      <option value="Chinese (Traditional)">Chinese (Traditional) (繁體中文)</option>
                      <option value="Japanese">Japanese (日本語)</option>
                      <option value="Korean">Korean (한국어)</option>
                      <option value="Turkish">Turkish (Türkçe)</option>
                      <option value="Polish">Polish (Polski)</option>
                      <option value="Vietnamese">Vietnamese (Tiếng Việt)</option>
                      <option value="Indonesian">Indonesian (Bahasa Indonesia)</option>
                      <option value="Thai">Thai (ภาษาไทย)</option>
                      <option value="Other">Other</option>
                    </Select>
                    {showErrors && errors.mbti_assessment_language && <p className="text-red-500 text-sm mt-1">{errors.mbti_assessment_language.message}</p>}
                  </div>

                  <div className="sm:col-span-2">
                    <Label className="mb-2 block">Was this test taken in your native language? <span className="text-red-500">*</span></Label>
                    <div className="flex gap-6">
                      <div className="flex items-center">
                        <Radio id="native_yes" value="Yes" {...register('took_in_native_language')} />
                        <Label htmlFor="native_yes" className="ml-2 font-normal">Yes</Label>
                      </div>
                      <div className="flex items-center">
                        <Radio id="native_no" value="No" {...register('took_in_native_language')} />
                        <Label htmlFor="native_no" className="ml-2 font-normal">No</Label>
                      </div>
                    </div>
                    {showErrors && errors.took_in_native_language && <p className="text-red-500 text-sm mt-1">{errors.took_in_native_language.message}</p>}
                  </div>

                  <div>
                    <Label htmlFor="mbti_core">Core Personality Type (4 Letters) <span className="text-red-500">*</span></Label>
                    <Select id="mbti_core" {...register('mbti_core')} className="mt-1">
                      <option value="">Select type</option>
                      <option value="INTJ">INTJ</option>
                      <option value="INTP">INTP</option>
                      <option value="ENTJ">ENTJ</option>
                      <option value="ENTP">ENTP</option>
                      <option value="INFJ">INFJ</option>
                      <option value="INFP">INFP</option>
                      <option value="ENFJ">ENFJ</option>
                      <option value="ENFP">ENFP</option>
                      <option value="ISTJ">ISTJ</option>
                      <option value="ISFJ">ISFJ</option>
                      <option value="ESTJ">ESTJ</option>
                      <option value="ESFJ">ESFJ</option>
                      <option value="ISTP">ISTP</option>
                      <option value="ISFP">ISFP</option>
                      <option value="ESTP">ESTP</option>
                      <option value="ESFP">ESFP</option>
                    </Select>
                    {showErrors && errors.mbti_core && <p className="text-red-500 text-sm mt-1">{errors.mbti_core.message}</p>}
                  </div>

                  <div>
                    <Label className="mb-2 block">Assertive vs. Turbulent Modifier <span className="text-red-500">*</span></Label>
                    <div className="space-y-2">
                      <div className="flex items-center">
                        <Radio id="mod_A" value="A" {...register('mbti_modifier')} />
                        <Label htmlFor="mod_A" className="ml-2 font-normal">Assertive (-A)</Label>
                      </div>
                      <div className="flex items-center">
                        <Radio id="mod_T" value="T" {...register('mbti_modifier')} />
                        <Label htmlFor="mod_T" className="ml-2 font-normal">Turbulent (-T)</Label>
                      </div>
                      <div className="flex items-center">
                        <Radio id="mod_NS" value="NOT_SURE" {...register('mbti_modifier')} />
                        <Label htmlFor="mod_NS" className="ml-2 font-normal">Not sure</Label>
                      </div>
                      {!requireFifthDim && (
                        <div className="flex items-center">
                          <Radio id="mod_UNKNOWN" value="UNKNOWN" {...register('mbti_modifier')} />
                          <Label htmlFor="mod_UNKNOWN" className="ml-2 font-normal">Not Tested / Unknown</Label>
                        </div>
                      )}
                    </div>
                    {showErrors && errors.mbti_modifier && <p className="text-red-500 text-sm mt-1">{errors.mbti_modifier.message}</p>}
                  </div>
                </div>

                <div className="space-y-6 pt-6 border-t border-gray-100">
                  <h3 className="font-medium text-gray-900">Validation Survey</h3>
                  <p className="text-sm text-gray-500 mb-4">Please rate how accurately the profile describes you (1 = Strongly Disagree, 5 = Strongly Agree).</p>

                  {[
                    {
                      id: 'dim_val_e_i',
                      label: "Accurately reflects how I direct my energy (Introversion vs Extraversion).",
                      explanation: "Extraverts (E) gain energy from social interaction, while Introverts (I) recharge in solitude."
                    },
                    {
                      id: 'dim_val_s_n',
                      label: "Accurately reflects how I process information (Sensing vs Intuition).",
                      explanation: "Sensing (S) focuses on concrete facts and details, while Intuition (N) focuses on patterns and future possibilities."
                    },
                    {
                      id: 'dim_val_t_f',
                      label: "Accurately reflects how I make decisions (Thinking vs Feeling).",
                      explanation: "Thinking (T) prioritizes objective logic, while Feeling (F) prioritizes empathy and social harmony."
                    },
                    {
                      id: 'dim_val_j_p',
                      label: "Accurately reflects how I approach my daily life and goals (Judging vs Perceiving).",
                      explanation: "Judging (J) prefers structure, planning, and closure, while Perceiving (P) prefers flexibility and spontaneity."
                    },
                    ...((mbtiModifier !== 'UNKNOWN' && mbtiModifier !== 'NOT_SURE') ? [{
                      id: 'dim_val_a_t',
                      label: "Accurately reflects my confidence and stress management (Assertive vs Turbulent).",
                      explanation: "Assertive (-A) individuals are self-assured and resistant to stress, while Turbulent (-T) individuals are success-driven, perfectionistic, and sensitive to stress."
                    }] : []),
                    {
                      id: 'overall_persona_fit',
                      label: "Overall, the personality description is a highly accurate representation of who I am.",
                      explanation: "Your general feeling about the complete personality profile."
                    }
                  ].map((item) => (
                    <div key={item.id} className="bg-gray-50 p-4 rounded-md">
                      <Label className="block mb-1 font-normal text-gray-700">{item.label} <span className="text-red-500">*</span></Label>
                      <p className="text-sm text-gray-500 mb-4 italic">{item.explanation}</p>
                      <div className="flex flex-col space-y-3 mt-4">
                        {[
                          { val: 1, text: "1 - Strongly Disagree" },
                          { val: 2, text: "2 - Disagree" },
                          { val: 3, text: "3 - Neutral" },
                          { val: 4, text: "4 - Agree" },
                          { val: 5, text: "5 - Strongly Agree" }
                        ].map((option) => (
                          <div key={option.val} className="flex items-center">
                            <Radio
                              id={`${item.id}_${option.val}`}
                              value={option.val.toString()}
                              {...register(item.id as any)}
                            />
                            <Label htmlFor={`${item.id}_${option.val}`} className="ml-3 font-normal text-gray-700">{option.text}</Label>
                          </div>
                        ))}
                      </div>
                      {showErrors && errors[item.id as keyof FormData] && (
                        <p className="text-red-500 text-sm mt-2">{(errors[item.id as keyof FormData] as any).message}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="space-y-6 pt-6 border-t border-gray-100">
                  <h3 className="font-medium text-gray-900">Qualitative Feedback (Optional)</h3>

                  <div>
                    <Label htmlFor="qualitative_alignment">Which specific parts of this description do you feel most accurately describe you? What do you agree with the most?</Label>
                    <Textarea id="qualitative_alignment" {...register('qualitative_alignment')} className="mt-1" />
                  </div>

                  <div>
                    <Label htmlFor="qualitative_divergence">Which specific parts of this description do you feel do NOT apply to you, or that you strongly disagree with?</Label>
                    <Textarea id="qualitative_divergence" {...register('qualitative_divergence')} className="mt-1" />
                  </div>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between pt-6 border-t border-gray-100">
              {step > 1 ? (
                <Button type="button" variant="outline" onClick={handlePrev} disabled={isSubmitting}>
                  Back
                </Button>
              ) : (
                <div></div>
              )}

              {step < STEPS ? (
                <Button type="button" onClick={handleNext}>
                  Next Step
                </Button>
              ) : (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Submitting..." : "Submit Assessment"}
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}