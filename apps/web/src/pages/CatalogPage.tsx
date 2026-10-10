import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui';
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
      <h1 className="mb-4 text-2xl font-semibold">{t('catalog.title')}</h1>
      {isPending && <p>{t('catalog.loading')}</p>}
      {isError && <p role="alert">{t('catalog.error')}</p>}
      {data && data.items.length === 0 && <p>{t('catalog.empty')}</p>}
      {data && data.items.length > 0 && (
        <>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2">{t('catalog.sku')}</th>
                <th>{t('catalog.name')}</th>
                <th>{t('catalog.unit')}</th>
                <th>{t('catalog.billing')}</th>
                <th>{t('catalog.active')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)]">
                  <td className="py-2">{p.sku}</td>
                  <td>
                    <Link className="underline" to={`/catalogo/${p.id}`}>
                      {p.name}
                    </Link>
                  </td>
                  <td>{p.unitOfMeasure}</td>
                  <td>{t(`billing.${p.billingModel}`)}</td>
                  <td>{p.isActive ? t('catalog.yes') : t('catalog.no')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex items-center gap-3 text-sm">
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
