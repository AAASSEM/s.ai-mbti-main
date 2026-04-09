import React, { useState, useEffect } from 'react';
import { persistence } from './lib/persistence';

import { auth, signInWithGoogle } from './lib/firebase';
import { supabase } from './lib/supabase';
import firebaseConfig from '../firebase-applet-config.json';
import seedData from './data/phase2_seed.json';
import { Button } from './components/ui/Button';
import { Checkbox } from './components/ui/Checkbox';
import { Label } from './components/ui/Label';
import { Download, Users, Settings, Database, Table } from 'lucide-react';
import { logAppError } from './lib/persistence';

export default function AdminPanel() {
  const [user, setUser] = useState<any>(null);
  const [requireFifth, setRequireFifth] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<{ responses: number } | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  // Supabase Email/Pass state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const isSupabase = import.meta.env.VITE_DATABASE_TYPE === 'supabase';

  const ALLOWED_ADMINS = [
    "aaaibrahim.1104@gmail.com",
    "casa.aibrahim@gmail.com",
    "aami.abdelfattah@gmail.com"
  ];

  const [recentData, setRecentData] = useState<any[]>([]);

  useEffect(() => {
    // 1. Unified Auth Listener
    const isSupabase = import.meta.env.VITE_DATABASE_TYPE === 'supabase';

    if (isSupabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          if (ALLOWED_ADMINS.includes(session.user.email || '')) {
            setUser(session.user);
            fetchData();
          }
        }
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          if (ALLOWED_ADMINS.includes(session.user.email || '')) {
            setUser(session.user);
            fetchData();
          } else {
            setAccessError("Unauthorized: This account does not have admin privileges.");
            supabase.auth.signOut();
          }
        } else {
          setUser(null);
        }
      });

      persistence.getSettings().then(v => {
        if (v) setRequireFifth(v.require_fifth_dimension);
      });

      return () => subscription.unsubscribe();
    } else {
      const unsubscribe = auth.onAuthStateChanged((u) => {
        if (u && !u.isAnonymous) {
          if (ALLOWED_ADMINS.includes(u.email || '')) {
            setUser(u);
            setAccessError(null);
            fetchData();
          } else {
            setUser(null);
            setAccessError("Unauthorized: This account does not have admin privileges.");
            auth.signOut();
          }
        } else {
          setUser(null);
        }
      });
      
      persistence.getSettings().then(snap => {
        if (snap) {
          setRequireFifth(snap.require_fifth_dimension);
        }
      });
      
      return () => unsubscribe();
    }
  }, []);

  const fetchData = async () => {
    setLoadingStats(true);
    try {
      const pList = await persistence.getAllAssessments();
      setStats({ responses: pList.length });
      
      const sorted = pList.sort((a, b) => new Date(b.consent_timestamp).getTime() - new Date(a.consent_timestamp).getTime());
      const top10 = sorted.slice(0, 10);
      
      const emailMap = await persistence.getAllEmails();
      
      const merged = top10.map(item => ({
        ...item,
        email: emailMap[item.uuid || item.participant_uuid]?.raw_email || 'N/A'
      }));
      
      setRecentData(merged);
    } catch (e) {
      console.error("Error fetching data:", e);
    }
    setLoadingStats(false);
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setAccessError(null);
      if (isSupabase) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        await signInWithGoogle();
      }
    } catch (e: any) {
      setAccessError(e.message || "Failed to sign in. Please check your credentials.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await persistence.saveSettings({
        require_fifth_dimension: requireFifth
      });
      alert("Settings saved!");
    } catch (e) {
      console.error(e);
      alert("Error saving settings. Are you authorized?");
    }
    setSaving(false);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const phase1Data = await persistence.getAllAssessments();
      const piiData = await persistence.getAllEmails();
      const trialsData = await persistence.getAllTrials();
      const errorsData = await persistence.getAllErrors();

      // Ensure PII is linked correctly for the export
      const enrichedPhase1 = phase1Data.map(item => ({
        ...item,
        email: piiData[item.uuid || item.participant_uuid]?.raw_email || 'N/A',
        secondary_email: piiData[item.uuid || item.participant_uuid]?.secondary_contact || 'N/A'
      }));

      const fullExport = {
        assessments: enrichedPhase1,
        study_trials: trialsData,
        system_errors: errorsData,
        export_timestamp: new Date().toISOString()
      };

      const blob = new Blob([JSON.stringify(fullExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `complete_study_export_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
      alert("Failed to export data. Check console for details.");
    }
    setExporting(false);
  };

  const seedPhase2Data = async () => {
    if (!window.confirm("This will deploy all persona-tailored content to the study cache. Continue?")) return;
    setLoadingStats(true);
    try {
      await persistence.seedContent(seedData);
      alert("Study content seeded successfully!");
    } catch (err) {
      console.error(err);
      alert("Error seeding data.");
    } finally {
      setLoadingStats(false);
    }
  };

  const handleExcelExport = async () => {
    setExporting(true);
    try {
      const analyticalData = await persistence.getAllAssessments();
      const piiData = await persistence.getAllEmails();
      const trialsData = await persistence.getAllTrials();
      
      // Count trial completions per participant
      const trialsByParticipant = trialsData.reduce((acc: any, d) => {
        const tid = d.participant_uuid;
        acc[tid] = (acc[tid] || 0) + 1;
        return acc;
      }, {});

      const mergedData = analyticalData.map(item => ({
        Timestamp: item.consent_timestamp,
        Email: piiData[item.uuid || item.participant_uuid]?.raw_email || 'N/A',
        MBTI_Core: item.mbti_type_core,
        Topics_Completed: trialsByParticipant[item.uuid || item.participant_uuid] || 0,
        Fit_Score: item.fit_score_extended?.toFixed(2) || 'N/A',
        Academic_Year: item.academic_year_career_stage,
        Major: item.primary_discipline,
        Institution: item.institutional_affiliation || item.institutional_affiliation_other,
        Country_of_Origin: item.country_of_origin || item.country_of_origin_other
      }));

      if (mergedData.length === 0) {
        alert("No data to export.");
        setExporting(false);
        return;
      }

      // Create CSV
      const headers = Object.keys(mergedData[0]);
      const csvContent = [
        headers.join(','),
        ...mergedData.map(row => 
          headers.map(header => {
            const val = (row as any)[header] ?? '';
            return `"${val.toString().replace(/"/g, '""')}"`;
          }).join(',')
        )
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `assessment_data_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Excel export failed:", e);
      alert("Failed to export Excel. check console.");
    }
    setExporting(false);
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 text-center max-w-sm w-full">
          <h1 className="text-2xl font-semibold mb-4">Admin Login</h1>
          <p className="text-gray-600 mb-6 text-sm">Please sign in to access the dashboard.</p>
          {accessError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
              {accessError}
            </div>
          )}
          
          {isSupabase ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="text-left">
                <Label htmlFor="admin_email">Email</Label>
                <Input id="admin_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="text-left">
                <Label htmlFor="admin_pass">Password</Label>
                <Input id="admin_pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full">Sign In</Button>
            </form>
          ) : (
            <Button onClick={() => handleLogin()} className="w-full">Sign in with Google</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Study Admin Dashboard</h1>
            <p className="text-sm text-gray-500">Logged in as: <span className="font-medium">{user.email}</span></p>
          </div>
          <Button variant="outline" onClick={() => {
            const isSupabase = import.meta.env.VITE_DATABASE_TYPE === 'supabase';
            if (isSupabase) supabase.auth.signOut();
            else auth.signOut();
          }}>Sign Out</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Stats Card */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-4 text-gray-900">
              <Users className="w-5 h-5 text-blue-600" />
              <h2 className="font-semibold">Participation</h2>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {loadingStats ? "..." : stats?.responses || 0}
            </div>
            <p className="text-sm text-gray-500 mt-1">Total completed assessments</p>
            <Button variant="ghost" size="sm" className="mt-4 w-full" onClick={fetchData}>Refresh Stats</Button>
          </div>

          {/* Export Card */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-4 text-gray-900">
              <Database className="w-5 h-5 text-green-600" />
              <h2 className="font-semibold">Data Access</h2>
            </div>
            <div className="flex flex-col gap-3">
              <Button className="w-full flex items-center justify-center gap-2" onClick={handleExport} disabled={exporting}>
                <Download className="w-4 h-4" />
                {exporting ? "..." : "Download JSON"}
              </Button>
              <Button variant="outline" className="w-full flex items-center justify-center gap-2" onClick={handleExcelExport} disabled={exporting}>
                <Table className="w-4 h-4" />
                {exporting ? "..." : "Download Excel (CSV)"}
              </Button>
              <Button variant="outline" className="w-full flex items-center justify-center gap-2 text-slate-600" onClick={seedPhase2Data} disabled={loadingStats}>
                <Database className="w-4 h-4" />
                {loadingStats ? "Seeding..." : "Seed Study Content"}
              </Button>
            </div>
          </div>

          {/* Settings Card */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-4 text-gray-900">
              <Settings className="w-5 h-5 text-purple-600" />
              <h2 className="font-semibold">Configuration</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <Checkbox 
                  id="require_fifth" 
                  checked={requireFifth}
                  onChange={(e) => setRequireFifth(e.target.checked)}
                  className="mt-1"
                />
                <Label htmlFor="require_fifth" className="text-sm font-medium text-gray-700 leading-tight">
                  Require 5th MBTI Dimension
                </Label>
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3 text-gray-900">
              <Database className="w-5 h-5 text-green-600" />
              <h2 className="font-semibold">Recent Responses</h2>
            </div>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loadingStats}>
              {loadingStats ? "Refreshing..." : "Refresh Data"}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-500">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">MBTI</th>
                  <th className="px-4 py-3">Fit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loadingStats ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center">Loading responses...</td></tr>
                ) : recentData.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center">No responses yet.</td></tr>
                ) : (
                  recentData.map((resp) => (
                    <tr key={resp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">
                        {new Date(resp.consent_timestamp).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 border-l border-gray-50">{resp.email}</td>
                      <td className="px-4 py-3">{resp.participant_age}</td>
                      <td className="px-4 py-3 font-semibold text-blue-700">{resp.mbti_type_full}</td>
                      <td className="px-4 py-3">
                        <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold">
                          {resp.fit_score_extended?.toFixed(1) || resp.fit_score_core_only?.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-100 p-6 rounded-xl">
          <h3 className="text-blue-900 font-semibold mb-2">How to access your data</h3>
          <p className="text-blue-800 text-sm leading-relaxed">
            As the owner, you have two primary ways to access the study data:
          </p>
          <ul className="list-disc list-inside text-blue-800 text-sm mt-3 space-y-2">
            <li><strong>Admin Dashboard (This Page):</strong> Use the "Download JSON" button above to get a merged file of all responses.</li>
            <li><strong>Firebase Console:</strong> Navigate to the <a href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/(default)/data`} target="_blank" rel="noopener noreferrer" className="underline font-bold">Firestore Database</a> to view raw documents in real-time.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
