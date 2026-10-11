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
      <Link to="/catalogo" className="link text-sm">
        ‹ {t('catalog.back')}
      </Link>
      {isPending && <p className="mt-4">{t('catalog.loading')}</p>}
      {error instanceof ApiError && error.status === 404 && <p className="mt-4">{t('catalog.notFound')}</p>}
      {data && (
        <>
          <h1 className="mt-4 text-[28px] font-bold leading-tight sm:text-[32px]">{data.name}</h1>
          <p className="text-sm text-[var(--secondary)]">{data.sku}</p>
          <dl className="card card-pad mt-6 grid max-w-xl grid-cols-[9rem_1fr] gap-y-3 text-sm [&>dt]:text-[var(--secondary)]">
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
