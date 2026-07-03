import { useState, useEffect, useCallback, useRef } from 'react';
import { DEMO_TOUR, DEMO_TOUR_ID } from '../../demoTour';
import type { CodeTourData } from '@plannotator/shared/tour';

export type { TourDiffAnchor, TourKeyTakeaway, TourStop, TourQAItem, CodeTourData } from '@plannotator/shared/tour';

export interface UseTourDataReturn {
  tour: CodeTourData | null;
  loading: boolean;
  error: string | null;
  checked: boolean[];
  toggleChecked: (index: number) => void;
  retry: () => void;
}

export function useTourData(jobId: string): UseTourDataReturn {
  const [tour, setTour] = useState<CodeTourData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChecklistRef = useRef<boolean[] | null>(null);

  const fetchTour = useCallback((): (() => void) | void => {
    if (!jobId) return;
    setLoading(true);
    setError(null);

    // Dev short-circuit: render the demo tour without a backend.
    if (jobId === DEMO_TOUR_ID) {
      setTour(DEMO_TOUR);
      setChecked(new Array(DEMO_TOUR.qa_checklist.length).fill(false));
      setLoading(false);
      return;
    }

    // Out-of-order guard: jobId can change (switching to a different completed
    // tour) while a previous fetch is still in flight. Without this, a slow
    // response for an OLDER jobId could resolve AFTER a newer jobId's fetch
    // and clobber its state. The effect below tears this down via the
    // returned cleanup whenever jobId changes (or on unmount).
    let cancelled = false;

    fetch(`/api/tour/${jobId}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Tour not found' : `HTTP ${res.status}`);
        return res.json();
      })
      .then((data: CodeTourData) => {
        if (cancelled) return;
        setTour(data);
        setChecked(data.checklist?.length > 0 ? data.checklist : new Array(data.qa_checklist.length).fill(false));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    return fetchTour();
  }, [fetchTour]);

  const saveChecklist = useCallback(
    (next: boolean[]) => {
      if (jobId === DEMO_TOUR_ID) return;
      pendingChecklistRef.current = next;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const payload = pendingChecklistRef.current;
        pendingChecklistRef.current = null;
        saveTimerRef.current = null;
        if (!payload) return;
        fetch(`/api/tour/${jobId}/checklist`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked: payload }),
        }).catch(() => {});
      }, 500);
    },
    [jobId],
  );

  const toggleChecked = useCallback(
    (index: number) => {
      // Compute the next array, THEN setState, THEN schedule the save — calling
      // saveChecklist (a side effect) inside the setState updater double-fires
      // it under React StrictMode's intentional double-invoke of updaters.
      const next = [...checked];
      next[index] = !next[index];
      setChecked(next);
      saveChecklist(next);
    },
    [checked, saveChecklist],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const payload = pendingChecklistRef.current;
      pendingChecklistRef.current = null;
      if (!payload || jobId === DEMO_TOUR_ID) return;
      // keepalive lets the request survive if this unmount is part of a tab close.
      fetch(`/api/tour/${jobId}/checklist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked: payload }),
        keepalive: true,
      }).catch(() => {});
    };
  }, [jobId]);

  return { tour, loading, error, checked, toggleChecked, retry: fetchTour };
}
