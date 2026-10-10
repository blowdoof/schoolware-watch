import type { ActionStamp } from '../shared/participation';
import type { TaskEntry } from '../shared/tasks';

export function actorName(actor: ActionStamp): string {
  return actor.label ?? `Naamloos toestel (${actor.participantId.slice(0, 6)})`;
}
export function ActionAttribution({ actor, prefix }: { actor?: ActionStamp | undefined; prefix: string }) {
  return <p className="mt-1 text-xs text-slate-600">{prefix}: {actor ? <>{actorName(actor)} · {new Date(actor.at).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}</> : 'wie niet geregistreerd'}</p>;
}
export function TaskParticipation({ task, disabled, onReview }: { task: TaskEntry; disabled: boolean;
  onReview?: ((id: string, kind: 'checked' | 'corrected', done: boolean) => Promise<void>) | undefined }) {
  return <div className="mt-2 text-xs" aria-label="Wijzigingen en controles">
    {(task.updatedAt || task.statusActor) && <ActionAttribution actor={task.statusActor} prefix="Status gewijzigd door" />}
    {task.help && <ActionAttribution actor={task.helpActor} prefix="Hulpvraag gewijzigd door" />}
    {onReview && <div className="mt-2 flex flex-wrap gap-3">{(['checked', 'corrected'] as const).map((kind) =>
      <label key={kind} className="flex items-center gap-2"><input type="checkbox" disabled={disabled}
        checked={task.reviews?.some((review) => review.kind === kind && review.self && !review.previous && review.done) ?? false}
        onChange={(event) => { void onReview(task.id, kind, event.target.checked); }} />{kind === 'checked' ? 'Door mij nagekeken' : 'Door mij verbeterd'}</label>)}</div>}
    {onReview && <p className="mt-1 text-slate-500">Deze vinkjes horen bij dit toestel en de ingestelde naam.</p>}
    {task.reviews?.filter((review) => review.done).length ? <ul className="mt-2 space-y-1">{task.reviews.filter((review) => review.done).map((review) =>
      <li key={`${review.version}:${review.kind}:${review.actor.participantId}`}>
        {review.kind === 'checked' ? 'Nagekeken door' : 'Verbeterd door'} {actorName(review.actor)} · {new Date(review.actor.at).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}
        {review.previous && <span className="ml-1 text-amber-800">(vorige taakinhoud — opnieuw controleren)</span>}
      </li>)}</ul> : <p className="mt-1 text-slate-500">Nog geen controles geregistreerd.</p>}
  </div>;
}
