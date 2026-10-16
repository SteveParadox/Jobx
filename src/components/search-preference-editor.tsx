'use client';
import { Button } from './ui';

const textFields = [
  ['q', 'Role, company or skills', 160],
  ['country', 'Country code', 2],
  ['region', 'State or region', 200],
  ['city', 'City', 200],
  ['eligibleCountry', 'Remote applicant country code', 2],
  ['category', 'Job category', 200],
  ['seniority', 'Seniority', 200],
  ['industry', 'Industry', 200],
  ['education', 'Education', 200],
] as const;
const options = {
  workplace: ['remote', 'hybrid', 'onsite', 'unknown'],
  employmentType: [
    'FULL_TIME',
    'PART_TIME',
    'CONTRACTOR',
    'TEMPORARY',
    'INTERN',
    'VOLUNTEER',
    'PER_DIEM',
    'OTHER',
  ],
  salaryPeriod: ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'],
  visa: ['true', 'false'],
} as const;
const labels = {
  workplace: 'Workplace',
  employmentType: 'Employment type',
  salaryPeriod: 'Salary period',
  visa: 'Explicit visa sponsorship',
};
export function SearchPreferenceEditor({
  name,
  filters,
  alert,
  busy,
  save,
  cancel,
}: {
  name: string;
  filters: unknown;
  alert?: { frequency: string; channel: string; enabled: boolean };
  busy: boolean;
  save: (data: unknown) => Promise<void>;
  cancel: () => void;
}) {
  const initial = (filters ?? {}) as Record<string, unknown>;
  const v = (key: string) => (initial[key] === undefined ? '' : String(initial[key]));
  return (
    <form
      className="stack panel"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const criteria: Record<string, unknown> = {};
        for (const key of [
          ...textFields.map(([key]) => key),
          ...Object.keys(options),
          'salaryMin',
          'currency',
          'experienceMax',
          'days',
          'sort',
        ]) {
          const value = data.get(key);
          if (value !== null && String(value).trim() !== '') criteria[key] = String(value).trim();
        }
        if (initial.company && data.get('keepCompany') === 'on') criteria.company = initial.company;
        void save({
          name: data.get('name'),
          filters: criteria,
          ...(alert
            ? {
                frequency: data.get('frequency'),
                channel: data.get('channel'),
                enabled: data.get('enabled') === 'on',
                consent: true,
              }
            : {}),
        });
      }}
    >
      <h3>Edit {alert ? 'alert' : 'saved search'}</h3>
      <label>
        Name
        <input name="name" defaultValue={name} required minLength={2} maxLength={100} />
      </label>
      <div className="form-grid">
        {textFields.map(([key, label, max]) => (
          <label key={key}>
            {label}
            <input
              name={key}
              defaultValue={v(key)}
              maxLength={max}
              pattern={key === 'country' || key === 'eligibleCountry' ? '[A-Za-z]{2}' : undefined}
            />
          </label>
        ))}
        {Object.entries(options).map(([key, values]) => (
          <label key={key}>
            {labels[key as keyof typeof labels]}
            <select name={key} defaultValue={v(key)}>
              <option value="">Any / unknown</option>
              {values.map((value) => (
                <option value={value} key={value}>
                  {key === 'visa'
                    ? value === 'true'
                      ? 'Explicitly offered'
                      : 'Explicitly unavailable'
                    : value.toLowerCase().replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Minimum disclosed salary
          <input
            type="number"
            name="salaryMin"
            min={0}
            max={100000000}
            defaultValue={v('salaryMin')}
          />
        </label>
        <label>
          Currency code
          <input
            name="currency"
            pattern="[A-Z]{3}"
            maxLength={3}
            placeholder="e.g. NGN, USD"
            defaultValue={v('currency')}
          />
        </label>
        <label>
          Experience ceiling (years)
          <input
            type="number"
            name="experienceMax"
            min={0}
            max={60}
            defaultValue={v('experienceMax')}
          />
        </label>
        <label>
          Posted within (days)
          <input type="number" name="days" min={1} max={365} defaultValue={v('days')} />
        </label>
      </div>
      <small>
        Salary filtering requires both a currency and a salary period. Unknown employer claims are
        not treated as confirmed.
      </small>
      {Boolean(initial.company) && (
        <label className="checkbox">
          <input type="checkbox" name="keepCompany" defaultChecked />
          Keep the company selected in the original search.
        </label>
      )}
      {!alert && (
        <label>
          Sort by
          <select name="sort" defaultValue={v('sort') || 'relevance'}>
            <option value="relevance">Relevance</option>
            <option value="recent">Most recent</option>
            <option value="salary">Salary, same currency and period</option>
          </select>
        </label>
      )}
      {alert && (
        <>
          <label>
            Frequency
            <select name="frequency" defaultValue={alert.frequency}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label>
            Delivery channel
            <select name="channel" defaultValue={alert.channel}>
              <option value="email">Email and in-app</option>
              <option value="in_app">In-app only</option>
            </select>
          </label>
          <label className="checkbox">
            <input name="enabled" type="checkbox" defaultChecked={alert.enabled} />
            Enable this alert.
          </label>
          <label className="checkbox">
            <input type="checkbox" required />I agree to receive matching vacancies through the
            selected channel. I can pause or delete this alert at any time.
          </label>
          <small>
            New criteria apply to openings published after you save these settings. Previously
            delivered jobs are not sent again.
          </small>
        </>
      )}
      <div className="row-actions">
        <Button disabled={busy}>Save {alert ? 'alert settings' : 'search settings'}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>
          Cancel editing
        </Button>
      </div>
    </form>
  );
}
