import React, { useCallback, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { CinematicIntro } from './components/CinematicIntro';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { isAutostartBypass, markIntroCompleted, shouldShowCinematicIntro } from './utils/introStorage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { PeriodTrackerPage } from './pages/PeriodTrackerPage';
import { PcosTrackerPage } from './pages/PcosTrackerPage';
import { MoodWellnessPage } from './pages/MoodWellnessPage';
import { NutritionPage } from './pages/NutritionPage';
import { WaterTrackerPage } from './pages/WaterTrackerPage';
import { HealthJournalPage } from './pages/HealthJournalPage';
import { ProfilePage } from './pages/ProfilePage';

export default function App() {
  const [showIntro, setShowIntro] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return shouldShowCinematicIntro({ autostartBypass: isAutostartBypass() });
  });

  const handleIntroComplete = useCallback(() => {
    markIntroCompleted();
    setShowIntro(false);
  }, []);

  const handleReplayIntro = useCallback(() => {
    setShowIntro(true);
  }, []);

  return (
    <ErrorBoundary>
      {showIntro && <CinematicIntro onComplete={handleIntroComplete} />}
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route
                path="/"
                element={<HomePage introVisible={showIntro} onReplayIntro={handleReplayIntro} />}
              />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/period-tracker"
                element={
                  <ProtectedRoute>
                    <PeriodTrackerPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/pcos-tracker"
                element={
                  <ProtectedRoute>
                    <PcosTrackerPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/wellness"
                element={
                  <ProtectedRoute>
                    <MoodWellnessPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/nutrition"
                element={
                  <ProtectedRoute>
                    <NutritionPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/water"
                element={
                  <ProtectedRoute>
                    <WaterTrackerPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/journal"
                element={
                  <ProtectedRoute>
                    <HealthJournalPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
