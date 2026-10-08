import { useState } from 'react';
import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { addDays, todayLA } from '~/domain/dates';
import { fillExtraJob, getExtraJobs } from '~/server/extra-jobs-fns';
import { Button, Icon, PageHead, Panel, Pill, RoutePlate, WarningDiamond, buttonClass, parseAmount, useFormat, useToast } from '~/ui';

type Data = Awaited<ReturnType<typeof getExtraJobs>>;
type Job = Data['jobs'][number];

export const Route = createFileRoute('/_app/extra-jobs/')({
  validateSearch: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  loaderDeps: ({ search }) => ({ date: search.date ?? todayLA() }),
  loader: async ({ deps }) => ({ date: deps.date, ...(await getExtraJobs({ data: { from: deps.date, to: deps.date } })) }),
  component: ExtraJobsPage,
});

function ExtraJobsPage() {
  const t = useT();
  const f = useFormat();
  const data = Route.useLoaderData();
  const dateLabel = f.date(data.date, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <>
      <PageHead title={t('xj.title')} lead={t('xj.lead')}
        actions={
          <div className="row">
            <div className="week-nav">
              <Link to="/extra-jobs" search={{ date: addDays(data.date, -1) }} aria-label={t('td.prevDay')}><Icon name="chevronLeft" width={18} height={18} /></Link>
              <span className="num">{dateLabel}</span>
              <Link to="/extra-jobs" search={{ date: addDays(data.date, 1) }} aria-label={t('td.nextDay')}><Icon name="chevronRight" width={18} height={18} /></Link>
            </div>
            {data.canLog && <Link to="/extra-jobs/new" search={{ date: data.date }} className={buttonClass('primary')}><Icon name="plus" width={18} height={18} />{t('xj.log')}</Link>}
          </div>
        } />
      <Panel title={t('xj.dayTitle', { date: dateLabel })} id="jobs">
        {data.jobs.length === 0 ? <p className="panel-body muted" style={{ margin: 0 }}>{t('xj.none')}</p> : (
          <ul className="job-list">{data.jobs.map((j) => <JobCard key={j.id} job={j} data={data} />)}</ul>
        )}
      </Panel>
    </>
  );
}

function JobCard({ job, data }: { job: Job; data: Data }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<'client_amount' | 'order_number' | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Dispatchers don't see client money, so "what T-Force pays" is not their item to fix.
  const missing = job.missing.filter((m) => m !== 'client_amount' || data.showMoney);
  const time = new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(job.createdAt));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch = editing === 'client_amount' ? { clientAmountCents: parseAmount(value) } : { orderNumber: value };
    if ('clientAmountCents' in patch && (patch.clientAmountCents == null)) return setError(t('error.invalid_amount'));
    const res = await fillExtraJob({ data: { id: job.id, ...patch } as { id: string; clientAmountCents?: number; orderNumber?: string } });
    if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
    toast(t('team.saved'));
    setEditing(null); setValue(''); setError(null);
    await router.invalidate();
  };

  return (
    <li className="job-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{t(`xj.svc.${job.service}` as MessageKey)}</strong>
        {missing.length ? <Pill tone="warn">{missing.length === 1 ? t('xj.oneThing') : t('xj.thingsMissing', { count: missing.length })}</Pill> : <Pill tone="ok">{t('xj.complete')}</Pill>}
      </div>
      <p style={{ margin: 0 }}>
        {job.payee}{job.contractor && <> <Pill tone="contractor">{t('pill.contractor')}</Pill></>}
        {job.nearRoute && <>, {t('xj.near', { route: '' })}<RoutePlate code={job.nearRoute} size="sm" /></>}
        {job.orderNumber && <>, {t('xj.order', { order: job.orderNumber })}</>}
      </p>
      <p className="muted num" style={{ margin: 0, fontSize: 14 }}>
        {data.showMoney && job.clientAmountCents != null && <>{t('xj.clientPays')} {f.money(job.clientAmountCents)} · </>}
        {t('xj.driverGets')} {f.money(job.driverAmountCents)} · {t('xj.saved', { time, who: job.by ?? t('audit.system') })}
      </p>
      {job.note && <p style={{ margin: 0, fontSize: 14 }}>{job.note}</p>}
      {missing.map((m) => (
        <div key={m} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <WarningDiamond size={20} /><span style={{ fontSize: 14 }}>{t(`xj.missing.${m}` as MessageKey)}</span>
        </div>
      ))}
      {!editing && missing.length > 0 && (
        <div className="row">
          {missing.includes('client_amount') && <Button size="sm" onClick={() => setEditing('client_amount')}>{t('xj.addClient')}</Button>}
          {missing.includes('order_number') && data.canLog && <Button size="sm" onClick={() => setEditing('order_number')}>{t('xj.addOrder')}</Button>}
        </div>
      )}
      {editing && (
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={save}>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label htmlFor={`fix-${job.id}`}>{t(editing === 'client_amount' ? 'xj.clientPays' : 'xj.orderNumber')}</label>
            <input id={`fix-${job.id}`} className="input" autoFocus required inputMode={editing === 'client_amount' ? 'decimal' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <Button type="submit" variant="primary">{t('common.save')}</Button>
          <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          {error && <p role="alert" className="field-error" style={{ margin: 0, flexBasis: '100%' }}>{error}</p>}
        </form>
      )}
    </li>
  );
}
