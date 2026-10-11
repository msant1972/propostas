import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, Button, Empty, PageHeader } from '../components/ui';
import type { ProductPage } from '@cpq/api-client';
import { apiGet } from '../lib/api';


export function CatalogPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, isPending, isError } = useQuery({
    queryKey: ['products', page],
    queryFn: () => apiGet<ProductPage>(`/catalog/products?page=${page}&pageSize=${pageSize}`),
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <section>
      <PageHeader title={t('catalog.title')} />
      {isPending && <p>{t('catalog.loading')}</p>}
      {isError && <p role="alert" className="text-[var(--danger)]">{t('catalog.error')}</p>}
      {data && data.items.length === 0 && <Empty>{t('catalog.empty')}</Empty>}
      {data && data.items.length > 0 && (
        <>
          <div className="table-card"><table>
            <thead>
              <tr>
                <th>{t('catalog.sku')}</th>
                <th>{t('catalog.name')}</th>
                <th>{t('catalog.unit')}</th>
                <th>{t('catalog.billing')}</th>
                <th>{t('catalog.active')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap font-mono text-[13px] text-[var(--secondary)]">{p.sku}</td>
                  <td>
                    <Link className="link" to={`/catalogo/${p.id}`}>
                      {p.name}
                    </Link>
                  </td>
                  <td>{p.unitOfMeasure}</td>
                  <td>{t(`billing.${p.billingModel}`)}</td>
                  <td><Badge tone={p.isActive ? 'green' : 'gray'}>{p.isActive ? t('catalog.yes') : t('catalog.no')}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="mt-5 flex items-center justify-center gap-3 text-sm text-[var(--secondary)]">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('catalog.previous')}
            </Button>
            <span>{t('catalog.page', { page, pages })}</span>
            <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t('catalog.next')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
