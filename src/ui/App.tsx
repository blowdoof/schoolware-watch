import { ConnectionPanel } from './ConnectionPanel';

type Page = 'popup' | 'dashboard' | 'options';

const titles: Record<Page, string> = {
  popup: 'Je agenda, met een geheugen.',
  dashboard: 'Observatiegeschiedenis',
  options: 'Instellingen en privacy',
};

export function App({ page }: { page: Page }) {
  return (
    <main className={page === 'popup' ? 'w-96 p-6' : 'mx-auto max-w-3xl px-6 py-12'}>
      <p className="text-xs font-bold uppercase tracking-widest text-teal-700">Schoolware Watch</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{titles[page]}</h1>
      <ConnectionPanel showSetup={page === 'options'} />
      {page === 'options' ? (
        <p className="mt-6 text-sm leading-6 text-slate-600">
          Je geschiedenis blijft lokaal in deze browser. Schoolware Watch bewaart geen
          inloggegevens. Controle-interval, bewaartermijn en gegevensbeheer worden hier beschikbaar.
        </p>
      ) : (
        <p className="mt-6 text-sm leading-6 text-slate-600">
          De geschiedenis toont wanneer taken en toetsen voor het eerst zijn waargenomen,
          gewijzigd zijn of niet meer zichtbaar zijn. De eerste controle vormt een beginpunt.
        </p>
      )}
      <nav aria-label="Navigatie" className="mt-6 flex gap-5 text-sm font-medium text-teal-700">
        {page !== 'dashboard' && <a href="dashboard.html" target="_blank" rel="noreferrer">Overzicht openen</a>}
        {page !== 'options' && <a href="options.html" target="_blank" rel="noreferrer">Instellingen</a>}
      </nav>
    </main>
  );
}
