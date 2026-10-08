import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useT, type MessageKey } from '~/i18n';
import { getAudit } from '~/server/audit-fns';
import { AUDIT_TABLES } from '~/server/audit-view';
import { PageHead, Panel, SelectField, buttonClass, useFormat } from '~/ui';

const search = z.object({ table: z.enum(AUDIT_TABLES).optional(), before: z.string().datetime().optional() });

export const Route = createFileRoute('/_app/settings/audit')({
  validateSearch: search,
  loaderDeps: ({ search: s }) => s,
  loader: ({ deps }) => getAudit({ data: deps }),
  component: AuditPage,
});

function AuditPage() {
  const t = useT();
  const f = useFormat();
  const { entries, nextBefore } = Route.useLoaderData();
  const { table, before } = Route.useSearch();
  const navigate = useNavigate({ from: '/settings/audit' });
  return (
    <>
      <PageHead title={t('audit.title')} lead={t('audit.lead')} />
      <div style={{ maxWidth: 320 }}>
        <SelectField label={t('audit.filter')} value={table ?? ''}
          onChange={(e) => navigate({ search: { table: (e.target.value || undefined) as (typeof AUDIT_TABLES)[number] | undefined } })}>
          <option value="">{t('audit.all')}</option>
          {AUDIT_TABLES.map((x) => <option key={x} value={x}>{x}</option>)}
        </SelectField>
      </div>
      <Panel>
        {entries.length === 0 ? <p className="panel-body muted" style={{ paddingTop: 20, margin: 0 }}>{t('audit.empty')}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{t('audit.when')}</th><th scope="col">{t('audit.who')}</th><th scope="col">{t('audit.what')}</th><th scope="col">{t('audit.fields')}</th><th scope="col">{t('audit.from')}</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{f.dateTime(e.at)}</td>
                    <td>{e.user ?? t('audit.system')}</td>
                    <td>{t(`audit.action.${e.action}` as MessageKey)} <code>{e.table}</code><span className="sub num">{e.recordId.slice(0, 8)}</span></td>
                    <td>{e.fields.length ? e.fields.join(', ') : '–'}</td>
                    <td>{t(`audit.source.${e.source}` as MessageKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel-body row" style={{ paddingTop: 16 }}>
          {before && <Link className={buttonClass('secondary', 'sm')} to="/settings/audit" search={{ table }}>{t('audit.newest')}</Link>}
          {nextBefore && <Link className={buttonClass('secondary', 'sm')} to="/settings/audit" search={{ table, before: nextBefore }}>{t('audit.older')}</Link>}
        </div>
      </Panel>
    </>
  );
}
