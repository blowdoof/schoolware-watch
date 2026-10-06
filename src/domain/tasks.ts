import { brusselsWallTime } from './notification-window';
import { agendaCategory } from './agenda-types';

/** Planning timestamps use Brussels wall time, independently of local progress. */
export function isPastTask(endsAt: string, now: Date): boolean {
  return endsAt <= brusselsWallTime(now);
}

export const TASK_STATUSES = ['open', 'in-progress', 'done'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export const isTaskStatus = (value: unknown): value is TaskStatus => TASK_STATUSES.includes(value as TaskStatus);
export const isTaskCategory = (category: string): boolean => category === 'tests' || category === 'assignments' || category === 'review';

/** Verified visual markers for the supported Schoolware installation. */
export const hasAgendaMarker = (typePunt: number): boolean => agendaCategory(typePunt) !== 'other';
