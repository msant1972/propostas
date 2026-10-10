import { useTranslation } from 'react-i18next';

export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto mt-24 max-w-md px-4">
      <h1 className="mb-2 text-2xl font-semibold">{t('forbidden.title')}</h1>
      <p>{t('forbidden.text')}</p>
    </main>
  );
}
