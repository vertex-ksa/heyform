import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

export default function OAuth() {
  const { t, i18n } = useTranslation()

  return (
    <section
      className="mx-auto max-w-lg space-y-4 px-6 py-8"
      dir={i18n.dir()}
      aria-labelledby="oauth-unavailable"
    >
      <h1
        id="oauth-unavailable"
        className="text-primary text-balance break-words text-2xl font-semibold"
      >
        {t('compatibility.oauthTitle')}
      </h1>
      <p className="text-secondary break-words">{t('compatibility.oauthUnavailable')}</p>
      <Link
        className="text-brand inline-block rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        to="/"
      >
        {t('compatibility.returnToWorkspace')}
      </Link>
    </section>
  )
}
