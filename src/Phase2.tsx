import React, { useState, useEffect } from 'react';
import { persistence, logAppError } from './lib/persistence';
import { v4 as uuidv4 } from 'uuid';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/Card';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import { Label } from './components/ui/Label';
import { Radio } from './components/ui/Radio';
import { Textarea } from './components/ui/Textarea';
import { AlertCircle, CheckCircle2, Loader2, Send, Settings } from 'lucide-react';

// --- IRB COMPLIANCE CONSTANTS ---
const APP_TITLE = "Content Styles Study";
const SUB_TITLE = "Educational Material Feedback Survey";
const EST_TIME = "Estimated Time: 10 - 15 minutes";
const TOTAL_STEPS = 4; // 1: Welcome, 2: Topic 1, 3: Topic 2, 4: Topic 3

const TOPICS = [
  { id: 'topic_1_trees', title: 'Topic 1: How Trees Communicate Underground' },
  { id: 'topic_2_bystander', title: 'Topic 2: The Bystander Effect' },
  { id: 'topic_3_headphones', title: 'Topic 3: How Noise-Canceling Headphones Work' }
];

type EvaluationState = {
  // Section 1-3 ratings (1-5) for each side
  comfort_a: number; tone_a: number; confidence_a: number;
  effort_a: number; attention_a: number; frustration_a: number;
  
  comfort_b: number; tone_b: number; confidence_b: number;
  effort_b: number; attention_b: number; frustration_b: number;

  // Comparison & Topic Specific
  preference: string; // Lesson A / Lesson B
  reason: string;
  prior_exposure: string; // Yes / No

  // Session State (Moved here for visibility)
  ai_familiarity: number;
  fatigue_stress: number;
};

export default function StudyApp() {
  const [step, setStep] = useState(0); // 0: Login, 1: Welcome, 2: Evaluation, 3: Completed
  useEffect(() => {
    document.title = "Content Styles Study";
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Participant State
  const [participantData, setParticipantData] = useState<{
    uuid: string;
    persona: string;
    isTest?: boolean;
  } | null>(null);
  const [testPersona, setTestPersona] = useState<string>("");
  const [hasConsented, setHasConsented] = useState(false);

  // Trial State
  const [currentTopicIdx, setCurrentTopicIdx] = useState(0);
  const [shuffledContent, setShuffledContent] = useState<{
    left: any;
    right: any;
    leftIsTypeX: boolean;
  } | null>(null);
  
  const [evaluation, setEvaluation] = useState<EvaluationState>({
    comfort_a: 0, tone_a: 0, confidence_a: 0, effort_a: 0, attention_a: 0, frustration_a: 0,
    comfort_b: 0, tone_b: 0, confidence_b: 0, effort_b: 0, attention_b: 0, frustration_b: 0,
    preference: '', reason: '', prior_exposure: '',
    ai_familiarity: 0, fatigue_stress: 0
  });

  // Steps total for the progress bar
  const TOTAL_STEPS = 4;
  const getCurrentStep = () => {
    if (step <= 1) return 1;
    if (step === 2) return 2 + currentTopicIdx;
    return 4;
  };

  // --- STEP 0: EMAIL LOOKUP ---
  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const emailInput = e.currentTarget.elements.namedItem('email') as HTMLInputElement;
    const email = emailInput.value.trim().toLowerCase();

    // --- TEST MODE OVERRIDE ---
    if (testPersona) {
      setParticipantData({
        uuid: `test_${testPersona}_${Date.now()}`,
        persona: testPersona,
        isTest: true
      });
      setStep(1);
      setLoading(false);
      return;
    }

    if (!email) {
      setError("Please enter an email or select a test persona.");
      setLoading(false);
      return;
    }

    try {
      const uData = await persistence.getParticipantByEmail(email);
      
      if (!uData) {
        setError("notfound");
        setLoading(false);
        return;
      }

      const hasCompleted = await persistence.checkIfCompleted(uData.uuid);
      if (hasCompleted) {
        setStep(3);
        setLoading(false);
        return;
      }

      setParticipantData({
        uuid: uData.uuid,
        persona: uData.mbti_type_core
      });
      setStep(1);
    } catch (err: any) {
      console.error(err);
      const eId = await logAppError('handleLogin', err, { email });
      setError(`We're sorry, an authentication error occurred. Please contact the researcher with ID: ${eId}`);
    } finally {
      setLoading(false);
    }
  };

  // --- STEP 2: LOAD TOPIC CONTENT ---
  const loadTopic = async (topicIdx: number) => {
    if (!participantData) return;
    setLoading(true);
    setShuffledContent(null); // Clear content immediately so user knows it's changing
    window.scrollTo(0, 0); // Reset scroll position to top
    setEvaluation({ 
      comfort_a: 0, tone_a: 0, confidence_a: 0, effort_a: 0, attention_a: 0, frustration_a: 0,
      comfort_b: 0, tone_b: 0, confidence_b: 0, effort_b: 0, attention_b: 0, frustration_b: 0,
      preference: '', reason: '', prior_exposure: '',
      ai_familiarity: 0, fatigue_stress: 0
    });
    
    const topicId = TOPICS[topicIdx].id;
    
    try {
      const { agnostic, curated } = await persistence.loadContent(topicId, participantData.persona);
      
      const contentA = agnostic?.content_body || "Content not found.";
      const contentC = curated?.content_body || contentA;

      const leftIsCurated = Math.random() > 0.5;
      setShuffledContent({
        left: leftIsCurated ? contentC : contentA,
        right: leftIsCurated ? contentA : contentC,
        leftIsTypeX: leftIsCurated
      });
      setStep(2);
    } catch (err) {
      console.error(err);
      const eId = await logAppError('loadTopic', err, { topicIdx, participantUuid: participantData?.uuid });
      setError(`Sorry, we couldn't load the study material. Please refresh or contact the researcher with ID: ${eId}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEvaluationSubmit = async () => {
    if (!participantData || !shuffledContent) return;
    setLoading(true);

    const trial_id = uuidv4();
    const topicId = TOPICS[currentTopicIdx].id;
    
    const curatedSelected = (evaluation.preference === 'LEFT' && shuffledContent.leftIsTypeX) || 
                            (evaluation.preference === 'RIGHT' && !shuffledContent.leftIsTypeX);

    try {
      await persistence.saveTrial({
        trial_id,
        participant_uuid: participantData.uuid,
        topic_id: topicId,
        timestamp: null, // Persistence layer handles timestamp
        left_is_style_x: shuffledContent.leftIsTypeX,
        ratings_a: {
          comfort: evaluation.comfort_a,
          tone: evaluation.tone_a,
          confidence: evaluation.confidence_a,
          effort: evaluation.effort_a,
          attention: evaluation.attention_a,
          frustration: evaluation.frustration_a
        },
        ratings_b: {
          comfort: evaluation.comfort_b,
          tone: evaluation.tone_b,
          confidence: evaluation.confidence_b,
          effort: evaluation.effort_b,
          attention: evaluation.attention_b,
          frustration: evaluation.frustration_b
        },
        overall_preference: evaluation.preference,
        prior_exposure: evaluation.prior_exposure,
        qualitative_reason: evaluation.reason,
        ai_familiarity: evaluation.ai_familiarity,
        fatigue_stress: evaluation.fatigue_stress,
        curated_selected_overall: curatedSelected,
        is_test: !!participantData.isTest
      });

      if (currentTopicIdx < TOPICS.length - 1) {
        const nextIdx = currentTopicIdx + 1;
        setCurrentTopicIdx(nextIdx);
        await loadTopic(nextIdx);
      } else {
        setStep(4); // Skip global Step 3 and go straight to Success
      }
    } catch (err) {
      console.error(err);
      const eId = await logAppError('handleEvaluationSubmit', err, { topicId, participantUuid: participantData?.uuid });
      setError(`We're sorry, there was a problem saving your responses. Please try again or share ID: ${eId} with the researcher.`);
    } finally {
      setLoading(false);
    }
  };

  // Final submission is handled during the last trial save

  const RatingScale = ({ label, value, onChange, low, high }: { label: string, value: number, onChange: (v: number) => void, low?: string, high?: string }) => (
    <div className="space-y-2">
      <Label className="text-xs font-bold text-gray-500 uppercase tracking-tight">{label}</Label>
      <div className="flex justify-between items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((num) => (
          <button
            key={num}
            type="button"
            onClick={() => onChange(num)}
            className={`flex-1 h-9 rounded-md text-sm font-bold transition-all border ${
              value === num 
                ? 'bg-gray-900 text-white border-gray-900 shadow-sm scale-105' 
                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
            }`}
          >
            {num}
          </button>
        ))}
      </div>
      {(low || high) && (
        <div className="flex justify-between text-[10px] text-gray-400 px-1">
          <span>1 = {low}</span>
          <span>5 = {high}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans text-gray-900">
      <div className={`${step === 2 ? 'max-w-6xl' : 'max-w-3xl'} mx-auto bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden transition-all duration-500`}>
        {/* Header - Matching Assessment Header */}
        <div className="bg-gray-900 px-6 py-8 sm:p-10 text-white text-center">
          <h1 className="text-2xl font-semibold">{APP_TITLE}</h1>
          <p className="text-gray-400 mt-1 text-sm">{SUB_TITLE}</p>
        </div>

        <div className="px-6 py-8 sm:p-10">
          {/* Progress Bar (Visible after login) */}
          {step > 0 && step < 3 && (
            <div className="mb-10">
              <div className="flex justify-between text-sm font-medium text-gray-500 mb-2">
                <span>Step {getCurrentStep()} of {TOTAL_STEPS}</span>
                <span>{Math.round((getCurrentStep() / TOTAL_STEPS) * 100)}% Completed</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-gray-900 h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${(getCurrentStep() / TOTAL_STEPS) * 100}%` }}
                ></div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start text-sm">
              <AlertCircle className="w-4 h-4 mr-3 shrink-0 mt-0.5" />
              {error === 'notfound' ? (
                <span>
                  Your email was not found. Please complete the initial assessment first, then return here.{' '}
                  <a href="https://s-aimain.vercel.app/" target="_blank" rel="noopener noreferrer" className="underline font-bold hover:text-red-900">
                    Click here to start the assessment →
                  </a>
                </span>
              ) : error}
            </div>
          )}

          {/* STEP 0: LOGIN */}
          {step === 0 && (
            <div className="max-w-md mx-auto space-y-8 animate-in fade-in duration-500">
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-900">Sign-In</h2>
                <p className="text-sm text-gray-500 mt-2">Enter your email to begin the session.</p>
              </div>
              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-semibold text-gray-700">Registered Email Address</Label>
                  <Input 
                    id="email" 
                    name="email" 
                    type="email" 
                    placeholder="example@university.edu" 
                    className="h-11 border-gray-200 focus:ring-gray-900 focus:border-gray-900" 
                  />
                </div>

                {/* TEST MODE HIDDEN FOR PRODUCTION - To re-enable, remove 'hidden' class */}
                <div className="hidden space-y-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center space-x-2 text-amber-600">
                    <Settings className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Debug / Test Options</span>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="testPersona" className="text-sm font-semibold text-gray-700">Override Persona for Testing</Label>
                    <select 
                      id="testPersona"
                      value={testPersona}
                      onChange={(e) => setTestPersona(e.target.value)}
                      className="w-full h-11 px-3 rounded-lg border-2 border-amber-100 focus:border-amber-400 bg-amber-50/30 text-sm font-medium outline-none transition-all"
                    >
                      <option value="">-- No Override (Use Email) --</option>
                      {["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"].map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className={`w-full h-11 font-bold rounded-lg transition-all ${testPersona ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-gray-900 hover:bg-black text-white'}`} 
                  disabled={loading}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (testPersona ? `Preview Study as ${testPersona}` : "Access Study Portal")}
                </Button>
              </form>
            </div>
          )}

          {/* STEP 1: WELCOME */}
          {step === 1 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center space-y-4">
                <h2 className="text-2xl font-bold text-gray-900">Get Started</h2>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-6 space-y-4 text-left">
                  <p className="text-gray-600 leading-relaxed">
                    In this session, you will review three different educational modules. For each module, you will see two slightly different versions (Material A and Material B).
                  </p>
                  <ul className="text-sm text-gray-500 space-y-2 list-disc pl-5">
                    <li>Read both versions thoroughly</li>
                    <li>Provide your feedback for each topic</li>
                    <li>{EST_TIME}</li>
                  </ul>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <input 
                  type="checkbox" 
                  id="voluntariness" 
                  checked={hasConsented}
                  onChange={(e) => setHasConsented(e.target.checked)}
                  className="mt-1 w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900" 
                />
                <Label htmlFor="voluntariness" className="text-sm text-gray-700 leading-snug cursor-pointer">
                  I understand that my participation is voluntary and my responses will be handled in accordance with the study's data privacy policies.
                </Label>
              </div>

              <div className="flex justify-end">
                <Button 
                  onClick={() => {
                    if (!hasConsented) {
                      alert("Please indicate your consent to proceed.");
                      return;
                    }
                    loadTopic(0);
                  }} 
                  className="min-w-[160px] h-11 bg-gray-900 hover:bg-black text-white font-bold"
                  disabled={loading || !hasConsented}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Begin Evaluation"}
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: EVALUATION INTERFACE */}
          {step === 2 && (
            <div className="space-y-10 animate-in fade-in duration-500">
              <div className="border-b border-gray-100 pb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 uppercase tracking-wide">
                    {TOPICS[currentTopicIdx].title}
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">Review both variations and complete the feedback form below.</p>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setStep(1)} 
                  className="text-gray-400 hover:text-gray-900"
                >
                  ← Back to Instructions
                </Button>
              </div>

              {/* SPLIT SCREEN COLUMNS */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 min-h-[400px]">
                {!shuffledContent ? (
                  <div className="col-span-1 lg:col-span-2 flex items-center justify-center h-64 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    <div className="text-center">
                      <Loader2 className="w-10 h-10 animate-spin text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500 font-medium">Preparing next learning material...</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Column A */}
                    <div className="flex flex-col bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                      <div className="bg-white px-5 py-3 border-b border-gray-200">
                        <span className="text-xs font-bold text-gray-400 uppercase">Style Variation A</span>
                      </div>
                      <div className="p-8 text-gray-700 leading-relaxed text-lg whitespace-pre-wrap">
                        {shuffledContent.left}
                      </div>
                    </div>

                    {/* Column B */}
                    <div className="flex flex-col bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                      <div className="bg-white px-5 py-3 border-b border-gray-200">
                        <span className="text-xs font-bold text-gray-400 uppercase">Style Variation B</span>
                      </div>
                      <div className="p-8 text-gray-700 leading-relaxed text-lg whitespace-pre-wrap">
                        {shuffledContent.right}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* SURVEY FORM */}
              <div className="bg-white pt-10 border-t border-gray-100 space-y-12">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-16">
                  {/* Lesson A Ratings */}
                  <div className="space-y-8 bg-gray-50/50 p-6 rounded-xl border border-gray-100">
                    <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest border-b border-gray-200 pb-2">Material A Feedback</h3>
                    <RatingScale label="Teaching Style Comfort" low="Uncomfortable" high="Comfortable" value={evaluation.comfort_a} onChange={(v) => setEvaluation(p => ({...p, comfort_a: v}))} />
                    <RatingScale label="Tutor Tone Match" low="Poor Match" high="Perfect Match" value={evaluation.tone_a} onChange={(v) => setEvaluation(p => ({...p, tone_a: v}))} />
                    <RatingScale label="Understanding Confidence" low="Not Confident" high="Very Confident" value={evaluation.confidence_a} onChange={(v) => setEvaluation(p => ({...p, confidence_a: v}))} />
                    <RatingScale label="Mental Effort Required" low="Minimal" high="Extensive" value={evaluation.effort_a} onChange={(v) => setEvaluation(p => ({...p, effort_a: v}))} />
                    <RatingScale label="Attention Held" low="Distracted" high="Fully Engaged" value={evaluation.attention_a} onChange={(v) => setEvaluation(p => ({...p, attention_a: v}))} />
                    <RatingScale label="Presentation Frustration" low="None" high="Extreme" value={evaluation.frustration_a} onChange={(v) => setEvaluation(p => ({...p, frustration_a: v}))} />
                  </div>

                  {/* Lesson B Ratings */}
                  <div className="space-y-8 bg-gray-50/50 p-6 rounded-xl border border-gray-100">
                    <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest border-b border-gray-200 pb-2">Material B Feedback</h3>
                    <RatingScale label="Teaching Style Comfort" low="Uncomfortable" high="Comfortable" value={evaluation.comfort_b} onChange={(v) => setEvaluation(p => ({...p, comfort_b: v}))} />
                    <RatingScale label="Tutor Tone Match" low="Poor Match" high="Perfect Match" value={evaluation.tone_b} onChange={(v) => setEvaluation(p => ({...p, tone_b: v}))} />
                    <RatingScale label="Understanding Confidence" low="Not Confident" high="Very Confident" value={evaluation.confidence_b} onChange={(v) => setEvaluation(p => ({...p, confidence_b: v}))} />
                    <RatingScale label="Mental Effort Required" low="Minimal" high="Extensive" value={evaluation.effort_b} onChange={(v) => setEvaluation(p => ({...p, effort_b: v}))} />
                    <RatingScale label="Attention Held" low="Distracted" high="Fully Engaged" value={evaluation.attention_b} onChange={(v) => setEvaluation(p => ({...p, attention_b: v}))} />
                    <RatingScale label="Presentation Frustration" low="None" high="Extreme" value={evaluation.frustration_b} onChange={(v) => setEvaluation(p => ({...p, frustration_b: v}))} />
                  </div>
                </div>

                <div className="space-y-10 max-w-4xl">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    {/* Q8: Preference */}
                    <div className="space-y-4">
                      <Label className="text-base font-bold text-gray-900">Which lesson did you prefer overall?</Label>
                      <div className="flex gap-4">
                        {['LEFT', 'RIGHT'].map((val) => (
                          <button
                            key={val}
                            onClick={() => setEvaluation(p => ({...p, preference: val}))}
                            className={`flex-1 py-4 px-6 rounded-xl border-2 font-bold transition-all ${
                              evaluation.preference === val
                                ? 'border-gray-900 bg-gray-900 text-white shadow-lg scale-105'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                            }`}
                          >
                            {val === 'LEFT' ? 'Material A' : 'Material B'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Q10: Prior Exposure */}
                    <div className="space-y-4">
                      <Label className="text-base font-bold text-gray-900">Had you been exposed to this specific topic before today?</Label>
                      <div className="flex gap-4">
                        {['Yes', 'No'].map((val) => (
                          <button
                            key={val}
                            onClick={() => setEvaluation(p => ({...p, prior_exposure: val}))}
                            className={`flex-1 py-4 px-6 rounded-xl border-2 font-bold transition-all ${
                              evaluation.prior_exposure === val
                                ? 'border-gray-900 bg-gray-900 text-white shadow-lg scale-105'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Q9: Reasoning */}
                  <div className="space-y-4">
                    <Label className="text-base font-bold text-gray-900">Briefly explain why you picked that lesson:</Label>
                    <Textarea 
                      value={evaluation.reason}
                      onChange={(e) => setEvaluation(prev => ({ ...prev, reason: e.target.value }))}
                      className="min-h-[120px] border-2 border-gray-100 focus:border-gray-900 transition-all text-lg"
                      placeholder="e.g. Tone, structure, level of detail..."
                    />
                  </div>

                  {/* Q11 & Q12: Session State (Added for each topic) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10 pt-6 border-t border-gray-100">
                    <RatingScale 
                      label="AI Familiarity" 
                      low="Never" 
                      high="Daily" 
                      value={evaluation.ai_familiarity} 
                      onChange={(v) => setEvaluation(p => ({...p, ai_familiarity: v}))} 
                    />
                    <RatingScale 
                      label="Current Fatigue/Stress" 
                      low="None" 
                      high="Extreme" 
                      value={evaluation.fatigue_stress} 
                      onChange={(v) => setEvaluation(p => ({...p, fatigue_stress: v}))} 
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-10 border-t border-gray-100">
                  <Button 
                    onClick={handleEvaluationSubmit}
                    disabled={loading || (!participantData?.isTest && (
                      !evaluation.preference || !evaluation.prior_exposure || !evaluation.reason.trim() || 
                      evaluation.comfort_a === 0 || evaluation.tone_a === 0 || evaluation.confidence_a === 0 || evaluation.effort_a === 0 || evaluation.attention_a === 0 || evaluation.frustration_a === 0 ||
                      evaluation.comfort_b === 0 || evaluation.tone_b === 0 || evaluation.confidence_b === 0 || evaluation.effort_b === 0 || evaluation.attention_b === 0 || evaluation.frustration_b === 0 ||
                      evaluation.ai_familiarity === 0 || evaluation.fatigue_stress === 0
                    ))}
                    className="h-14 px-10 bg-gray-900 hover:bg-black text-white font-black rounded-xl shadow-xl transition-all"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (currentTopicIdx < TOPICS.length - 1 ? "Continue to Next Section" : "Submit Study Responses")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* GLOBAL FEEDBACK NOT NEEDED - CAPTURED PER TRIAL */}

          {/* STEP 4: SUCCESS */}
          {step === 4 && (
            <div className="text-center py-20 animate-in zoom-in-95 duration-700">
              <div className="bg-green-100 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
                <CheckCircle2 className="w-12 h-12 text-green-600" />
              </div>
              <h2 className="text-3xl font-black text-gray-900 mb-6 uppercase tracking-tight">Thank You</h2>
              <div className="max-w-md mx-auto space-y-6 text-gray-600">
                <p className="text-lg">Your contributions have been successfully recorded. Your feedback helps us build better learning environments.</p>
                <div className="p-6 bg-gray-900 text-white rounded-2xl shadow-2xl font-bold">
                  Please notify the research team that you have finished your session.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
