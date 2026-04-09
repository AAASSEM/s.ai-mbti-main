import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AssessmentForm from './Assessment';
import AdminPanel from './Admin';
import Phase2App from './Phase2';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AssessmentForm />} />
        <Route path="/study" element={<Phase2App />} />
        <Route path="/admin" element={<AdminPanel />} />
      </Routes>
    </BrowserRouter>
  );
}
