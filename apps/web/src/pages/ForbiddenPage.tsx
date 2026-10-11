import { useTranslation } from 'react-i18next';

export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto mt-24 max-w-md px-4 text-center">
      <h1 className="mb-4 text-[28px] font-bold leading-tight">{t('forbidden.title')}</h1>
      <p className="text-[var(--secondary)]">{t('forbidden.text')}</p>
    </main>
  );
}
