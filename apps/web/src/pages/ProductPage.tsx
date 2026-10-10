import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiGet } from '../lib/api';
import type { Product } from '@cpq/api-client';

export function ProductPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { data, isPending, error } = useQuery({
    queryKey: ['product', id],
    queryFn: () => apiGet<Product>(`/catalog/products/${id}`),
  });

  return (
    <section>
      <Link to="/catalogo" className="text-sm underline">
        {t('catalog.back')}
      </Link>
      {isPending && <p className="mt-4">{t('catalog.loading')}</p>}
      {error instanceof ApiError && error.status === 404 && <p className="mt-4">{t('catalog.notFound')}</p>}
      {data && (
        <>
          <h1 className="mt-4 text-2xl font-semibold">{data.name}</h1>
          <p className="text-sm opacity-70">{data.sku}</p>
          <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt>{t('catalog.unit')}</dt>
            <dd>{data.unitOfMeasure}</dd>
            <dt>{t('catalog.billing')}</dt>
            <dd>{t(`billing.${data.billingModel}`)}</dd>
            <dt>{t('catalog.description')}</dt>
            <dd>{data.description ?? '—'}</dd>
          </dl>
        </>
      )}
    </section>
  );
}
