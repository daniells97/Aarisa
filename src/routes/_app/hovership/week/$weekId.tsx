import { Fragment, useRef, useState } from 'react';
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import { addDays, weekStart } from '~/domain/dates';
import { getHovershipWeek, resolveHovershipCode, saveBonus, uploadHovershipReport } from '~/server/hovership-fns';
import { getSetup } from '~/server/setup-fns';
import type { ImportOutcome } from '~/server/hovership';
import {
  Button, Figures, Icon, ImportNotice, PageHead, Panel, ReadingSteps, SelectField, TextField, WarningDiamond,
  buttonClass, centsToInput, parseAmount, useFormat, useToast,
} from '~/ui';

type Week = Awaited<ReturnType<typeof getHovershipWeek>>;

export const Route = createFileRoute('/_app/hovership/week/$weekId')({
  beforeLoad: ({ params }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.weekId) || weekStart(params.weekId) !== params.weekId) throw notFound();
  },
  loader: ({ params }) => getHovershipWeek({ data: { start: params.weekId } }),
  component: HovershipWeek,
});

const MAX_BYTES = 5_000_000;

function HovershipWeek() {
  const t = useT();
  const f = useFormat();
  const week = Route.useLoaderData();
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, setPending] = useState<{ fileName: string; text: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const range = `${f.date(week.week.start, { month: 'long', day: 'numeric' })} – ${f.date(week.week.end, { month: 'long', day: 'numeric' })}`;
  const which = week.week.start === week.period.start ? t('hs.first') : t('hs.second');

  const send = async (file: { fileName: string; text: string }, columnOverride?: Record<string, string>) => {
    setUploadError(null);
    setOutcome(null);
    setReading(file.fileName);
    try {
      const res = await uploadHovershipReport({ data: { ...file, columnOverride } });
      if (!res.ok) return setUploadError(t(`error.${res.code}` as MessageKey));
      setOutcome(res.value);
      setPending(res.value.status === 'layout_changed' ? file : null);
      if (res.value.status === 'done' || res.value.status === 'partial') toast(t('imp.imported', { rows: res.value.rows }));
      await router.invalidate();
    } catch {
      setUploadError(t('error.generic'));
    } finally {
      setReading(null);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) return setUploadError(t('error.file_too_big'));
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return setUploadError(t('error.not_csv'));
    await send({ fileName: file.name, text: await file.text() });
  };

  const uploadButton = (label: MessageKey = 'hs.upload', primary = false) => week.canImport && (
    <Button variant={primary ? 'primary' : 'secondary'} onClick={() => fileInput.current?.click()} disabled={reading != null}>
      <Icon name="upload" width={18} height={18} />{t(label)}
    </Button>
  );

  return (
    <>
      <PageHead
        title={t('hs.title')}
        lead={t('hs.lead', { range, which, period: f.date(week.period.start, { month: 'long', day: 'numeric' }) })}
        actions={
          <div className="row">
            <WeekNav start={week.week.start} />
            {uploadButton()}
            <Link to="/payroll" className={buttonClass('primary')}>{t('hs.toPayroll')}</Link>
          </div>
        }
      />
      <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={onFile} aria-label={t('hs.upload')} />
      {uploadError && <p role="alert" className="notice" style={{ margin: 0 }}><WarningDiamond size={22} />{uploadError}</p>}
      {week.locked && <p className="notice notice-info" style={{ margin: 0 }}>{t('hs.locked')}</p>}

      <ImportState week={week} range={range} reading={reading} outcome={outcome}
        onUseColumn={(field, header) => pending && send(pending, { [field]: header })}
        uploadButton={uploadButton} />

      {week.drivers.length > 0 && <WeekFigures week={week} />}
      {week.missingRates > 0 && (
        <p className="notice" role="alert" style={{ margin: 0 }}><WarningDiamond size={22} />{t('hs.missingRates', { count: week.missingRates })}</p>
      )}
      {week.drivers.length > 0 ? <DriversTable week={week} /> : !reading && week.importState && <Panel><p className="panel-body" style={{ paddingTop: 20, margin: 0 }}>{t('hs.noData')}</p></Panel>}
      {week.drivers.length > 0 && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          {week.showMoney && <LostMoney week={week} />}
          <RatesUsed week={week} />
        </div>
      )}
    </>
  );
}

function WeekNav({ start }: { start: string }) {
  const t = useT();
  const f = useFormat();
  return (
    <div className="week-nav">
      <Link to="/hovership/week/$weekId" params={{ weekId: addDays(start, -7) }} aria-label={t('hs.prevWeek')}><Icon name="chevronLeft" width={18} height={18} /></Link>
      <span className="num">{f.date(start, { month: 'short', day: 'numeric' })}</span>
      <Link to="/hovership/week/$weekId" params={{ weekId: addDays(start, 7) }} aria-label={t('hs.nextWeek')}><Icon name="chevronRight" width={18} height={18} /></Link>
    </div>
  );
}

function ImportState({ week, range, reading, outcome, onUseColumn, uploadButton }: {
  week: Week; range: string; reading: string | null; outcome: ImportOutcome | null;
  onUseColumn: (field: string, header: string) => void; uploadButton: (label?: MessageKey, primary?: boolean) => React.ReactNode;
}) {
  const t = useT();
  const f = useFormat();
  if (reading) return <ReadingSteps fileName={reading} />;

  if (outcome?.status === 'failed') {
    return (
      <ImportNotice title={t(`imp.failed.${outcome.reason}`, { dates: (outcome.dates ?? []).map((d) => f.date(d, { month: 'short', day: 'numeric' })).join(', ') })}
        actions={uploadButton('hs.uploadOther')} />
    );
  }

  if (outcome?.status === 'layout_changed') {
    return (
      <ImportNotice title={t('imp.layoutTitle')} actions={<>
        {outcome.suggestions.filter((s) => s.header).map((s) => (
          <Button key={s.field} variant="primary" onClick={() => onUseColumn(s.field, s.header!)}>{t('imp.useColumn', { header: s.header! })}</Button>
        ))}
        {uploadButton('hs.uploadOther')}
      </>}>
        {outcome.suggestions.map((s) => (
          <p key={s.field} style={{ margin: 0 }}>
            {t('imp.layoutMissing', { column: s.field })} {s.header ? t('imp.layoutSuggest', { header: s.header }) : t('imp.layoutNoSuggest')}
          </p>
        ))}
        <p className="muted" style={{ margin: 0 }}>{t('imp.nothingSaved')}</p>
      </ImportNotice>
    );
  }

  if (!week.importState && week.drivers.length === 0) {
    return (
      <ImportNotice tone="info" title={t('imp.waitingTitle', { range })} actions={uploadButton('hs.uploadYourself', true)}>
        <p style={{ margin: 0 }}>{t('imp.waitingBody')}</p>
        {week.lastImportAt && <p className="muted" style={{ margin: 0 }}>{t('imp.lastArrived', { when: f.dateTime(week.lastImportAt) })}</p>}
      </ImportNotice>
    );
  }

  if (week.unknownCodes.length > 0) return <PartlyRead week={week} />;

  const imp = week.importState;
  const problems = imp?.problems ?? {};
  return (
    <ImportNotice tone={problems.badLines?.length || problems.totalsMismatch?.length ? 'warn' : 'ok'}
      title={t('imp.doneTitle', { rows: week.totals.rows ?? 0, drivers: week.totals.drivers ?? 0 })}>
      {imp?.receivedAt && <p className="muted" style={{ margin: 0 }}>{t('imp.doneVia', { channel: t(`imp.channel.${imp.channel === 'email' ? 'email' : 'upload'}`), when: f.dateTime(imp.receivedAt) })}</p>}
      {!!problems.badLines?.length && <p style={{ margin: 0 }}>{t('imp.badLines', { count: problems.badLines.length, lines: problems.badLines.map((b) => b.line).join(', ') })}</p>}
      {!!problems.totalsMismatch?.length && <p style={{ margin: 0 }}>{t('imp.mismatch', { count: problems.totalsMismatch.length })}</p>}
    </ImportNotice>
  );
}

function PartlyRead({ week }: { week: Week }) {
  const t = useT();
  const unknownRows = week.unknownCodes.reduce((s, c) => s + c.days, 0);
  const total = (week.totals.rows ?? 0) + unknownRows;
  return (
    <ImportNotice title={t('imp.partialTitle', { read: week.totals.rows ?? 0, total, count: week.unknownCodes.length })}>
      <p style={{ margin: 0 }}>{t('imp.partialBody')}</p>
      <div>
        {week.unknownCodes.map((c) => <UnknownCode key={c.exceptionId} code={c} canResolve={week.canResolve} />)}
      </div>
    </ImportNotice>
  );
}

function UnknownCode({ code, canResolve }: { code: Week['unknownCodes'][number]; canResolve: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<'new' | 'match' | null>(null);
  const [name, setName] = useState(code.name);
  const [driverId, setDriverId] = useState('');
  const [drivers, setDrivers] = useState<{ id: string; fullName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const openMatch = async () => {
    setMode('match');
    const setup = await getSetup();
    setDrivers(setup.drivers.filter((d) => d.active));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolution = mode === 'new' ? { action: 'new_driver' as const, fullName: name } : { action: 'match' as const, driverId };
    try {
      const res = await resolveHovershipCode({ data: { exceptionId: code.exceptionId, resolution } });
      if (!res.ok) return setError(t(`error.${res.code}` as MessageKey));
      toast(t('imp.resolved', { code: code.code }));
      await router.invalidate();
    } catch {
      setError(t('error.generic'));
    }
  };
  return (
    <div className="code-row">
      <div>
        <strong className="num">{code.code}</strong>{code.name && <> · {code.name}</>}
        <span className="sub">{t('imp.codeSummary', { days: code.days, packages: code.packages })}</span>
      </div>
      {canResolve && !mode && (
        <div className="row">
          <Button onClick={() => setMode('new')}>{t('imp.addNewDriver')}</Button>
          <Button onClick={openMatch}>{t('imp.matchDriver')}</Button>
        </div>
      )}
      {mode && (
        <form onSubmit={submit} className="row" style={{ alignItems: 'flex-end' }}>
          {mode === 'new'
            ? <TextField label={t('imp.newDriverName', { code: code.code })} required value={name} onChange={(e) => setName(e.target.value)} />
            : (
              <SelectField label={t('imp.matchLabel', { code: code.code })} required value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="" />
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
              </SelectField>
            )}
          <Button type="submit" variant="primary">{t(mode === 'new' ? 'imp.saveNew' : 'imp.saveMatch')}</Button>
          <Button onClick={() => setMode(null)}>{t('common.cancel')}</Button>
          {error && <p role="alert" className="field-error" style={{ margin: 0, flexBasis: '100%' }}>{error}</p>}
        </form>
      )}
    </div>
  );
}

function WeekFigures({ week }: { week: Week }) {
  const t = useT();
  const f = useFormat();
  const x = week.totals;
  return (
    <Panel>
      <Figures items={[
        { label: t('hs.tier13'), value: f.number(x.t13 ?? 0) },
        { label: t('hs.tier4'), value: f.number(x.t4 ?? 0) },
        { label: t('hs.stat'), value: f.number(x.stat ?? 0) },
        { label: t('hs.bonuses'), value: f.money(x.bonusCents) },
        week.showMoney
          ? { label: t('hs.profit'), value: <span className={(x.operationProfitCents ?? 0) < 0 ? 'neg' : undefined}>{f.money(x.operationProfitCents)}</span>, note: t('hs.profitNote', { stem: f.money(x.stemCents) }) }
          : { label: t('hs.driverPay'), value: f.money(x.driverPayCents) },
      ]} />
    </Panel>
  );
}

function DriversTable({ week }: { week: Week }) {
  const t = useT();
  const f = useFormat();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const money = week.showMoney;
  const x = week.totals;
  return (
    <Panel title={t('hs.driversTitle', { count: week.drivers.length })} id="drivers" aside={week.canEditBonus && <span className="muted">{t('hs.bonusOnly')}</span>}>
      {money && <p className="panel-body muted" style={{ margin: 0, fontSize: 13.5 }}>{t('hs.marginNote')}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('hs.driver')}</th><th scope="col" className="r">{t('hs.days')}</th>
              <th scope="col" className="r">{t('hs.t13')}</th><th scope="col" className="r">{t('hs.t4')}</th><th scope="col" className="r">{t('hs.statCol')}</th>
              <th scope="col" className="r">{t('hs.routePay')}</th><th scope="col" className="r">{t('hs.bonus')}</th>
              <th scope="col" className="r">{t('hs.driverTotal')}</th>{money && <th scope="col" className="r">{t('hs.margin')}</th>}
            </tr>
          </thead>
          <tbody>
            {week.drivers.map((d) => {
              const isOpen = open.has(d.driverId);
              return (
                <Fragment key={d.driverId}>
                  <tr>
                    <td>
                      <button type="button" className="linklike" aria-expanded={isOpen} onClick={() => toggle(d.driverId)}
                        aria-label={t(isOpen ? 'hs.hideDays' : 'hs.showDays', { name: d.name })}>
                        <Icon name="chevronDown" width={16} height={16} style={{ transform: isOpen ? 'none' : 'rotate(-90deg)' }} />
                        <span><strong>{d.name}</strong><span className="sub">{d.code}</span></span>
                      </button>
                    </td>
                    <td className="r num">{d.days.length}</td>
                    <td className="r num">{f.number(d.t13 ?? 0)}</td><td className="r num">{f.number(d.t4 ?? 0)}</td><td className="r num">{f.number(d.stat ?? 0)}</td>
                    <td className="r num">{f.money(d.routePayCents)}</td><td className="r num">{f.money(d.bonusCents)}</td>
                    <td className="r num"><strong>{f.money(d.driverPayCents)}</strong></td>
                    {money && <td className={`r num${(d.marginCents ?? 0) < 0 ? ' neg' : ''}`}>{f.money(d.marginCents)}</td>}
                  </tr>
                  {isOpen && d.days.map((day) => (
                    <tr key={day.date} className="day-row">
                      <td style={{ paddingLeft: 44 }}>{f.date(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                      <td />
                      <td className="r num">{day.t13}</td><td className="r num">{day.t4}</td><td className="r num">{day.stat}</td>
                      <td className="r num">{f.money(day.routePayCents)}</td>
                      <td className="r">
                        {week.canEditBonus
                          ? <BonusInput driverId={d.driverId} name={d.name} date={day.date} cents={day.bonusCents ?? 0} />
                          : <span className="num">{f.money(day.bonusCents)}</span>}
                      </td>
                      <td className="r num">{f.money(day.driverPayCents)}</td>
                      {money && <td className={`r num${(day.marginCents ?? 0) < 0 ? ' neg' : ''}`}>{f.money(day.marginCents)}</td>}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            <tr className="total-row">
              <td>{t('hs.total')}</td><td className="r num">{x.rows}</td>
              <td className="r num">{f.number(x.t13 ?? 0)}</td><td className="r num">{f.number(x.t4 ?? 0)}</td><td className="r num">{f.number(x.stat ?? 0)}</td>
              <td className="r num">{f.money(x.routePayCents)}</td><td className="r num">{f.money(x.bonusCents)}</td>
              <td className="r num">{f.money(x.driverPayCents)}</td>
              {money && <td className={`r num${(x.marginSumCents ?? 0) < 0 ? ' neg' : ''}`}>{f.money(x.marginSumCents)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function BonusInput({ driverId, name, date, cents }: { driverId: string; name: string; date: string; cents: number }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(centsToInput(cents));
  const [error, setError] = useState(false);
  const save = async () => {
    const parsed = parseAmount(value);
    if (parsed === undefined) return setError(true);
    setError(false);
    const next = parsed ?? 0;
    if (next === cents) return;
    const res = await saveBonus({ data: { driverId, date, bonusCents: next } });
    if (!res.ok) { toast(t(`error.${res.code}` as MessageKey)); setValue(centsToInput(cents)); return; }
    const dateLabel = f.date(date, { month: 'short', day: 'numeric' });
    toast(t('hs.bonusSaved', { name, date: dateLabel, amount: f.money(next) }), async () => {
      await saveBonus({ data: { driverId, date, bonusCents: cents } });
      setValue(centsToInput(cents));
      await router.invalidate();
    });
    await router.invalidate();
  };
  return (
    <input className="input money-input num" inputMode="decimal" value={value} aria-invalid={error || undefined}
      aria-label={t('hs.bonusFor', { name, date: f.date(date, { month: 'long', day: 'numeric' }) })}
      onChange={(e) => setValue(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

const LOST_SHOWN = 5;

function LostMoney({ week }: { week: Week }) {
  const t = useT();
  const f = useFormat();
  const [all, setAll] = useState(false);
  const shown = all ? week.lostMoney : week.lostMoney.slice(0, LOST_SHOWN);
  return (
    <Panel title={t('hs.lostTitle')} id="lost" aside={week.lostMoney.length > 0 && <span className="muted">{t('hs.lostCount', { count: week.lostMoney.length })}</span>}>
      <div className="panel-body">
        {week.lostMoney.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('hs.lostNone')}</p> : (
          <>
            {shown.map((d) => (
              <div key={`${d.driverId}-${d.date}`} className="lost">
                <WarningDiamond size={22} />
                <p style={{ margin: 0 }}>{t('hs.lostLine', {
                  name: d.name, date: f.date(d.date, { weekday: 'short', month: 'short', day: 'numeric' }),
                  packages: d.t13 + d.t4, bonus: f.money(d.bonusCents), margin: f.money(d.marginCents),
                })}</p>
              </div>
            ))}
            {week.lostMoney.length > LOST_SHOWN && (
              <Button size="sm" aria-expanded={all} onClick={() => setAll((a) => !a)}>
                {t(all ? 'hs.lostFewer' : 'hs.lostAll', { count: week.lostMoney.length })}
              </Button>
            )}
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 13.5 }}>{t('hs.lostHint')}</p>
          </>
        )}
      </div>
    </Panel>
  );
}

function RatesUsed({ week }: { week: Week }) {
  const t = useT();
  const f = useFormat();
  const label: Record<string, MessageKey> = { t1_3: 'hs.tier13', t4: 'hs.tier4', stat: 'hs.stat' };
  return (
    <Panel title={t('hs.ratesTitle')} id="rates" aside={<Link to="/settings/rates">{t('hs.editRates')}</Link>}>
      <table>
        <thead><tr><th scope="col">{t('hs.item')}</th>{week.showMoney && <th scope="col" className="r">{t('rates.client')}</th>}<th scope="col" className="r">{t('hs.driver')}</th></tr></thead>
        <tbody>
          {week.rates.map((r) => (
            <tr key={r.item}>
              <td>{t(label[r.item]!)}</td>
              {week.showMoney && <td className="r num">{r.missing ? t('hs.missing') : f.money(r.clientCents)}</td>}
              <td className="r num">{r.missing ? <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}><WarningDiamond size={18} />{t('hs.missing')}</span> : f.money(r.driverCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
