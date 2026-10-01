export const LOCALE_OPTIONS = [
  ...(import.meta.env.DEV && import.meta.env.VITE_FORM_APPROVAL_LOCAL_ENABLED === 'true'
    ? [
        {
          value: 'ar',
          label: 'compatibility.arabicPreview',
          translated: 'compatibility.arabicPreviewHelp'
        }
      ]
    : []),
  {
    value: 'de',
    label: 'languages.de.original',
    translated: 'languages.de.translated'
  },
  {
    value: 'en',
    label: 'languages.en.original',
    translated: 'languages.en.translated'
  },
  {
    value: 'fr',
    label: 'languages.fr.original',
    translated: 'languages.fr.translated'
  },
  {
    value: 'it',
    label: 'languages.it.original',
    translated: 'languages.it.translated'
  },
  {
    value: 'ja',
    label: 'languages.ja.original',
    translated: 'languages.ja.translated'
  },
  {
    value: 'pl',
    label: 'languages.pl.original',
    translated: 'languages.pl.translated'
  },
  {
    value: 'pt-br',
    label: 'languages.pt-br.original',
    translated: 'languages.pt-br.translated'
  },
  {
    value: 'zh-cn',
    label: 'languages.zh-cn.original',
    translated: 'languages.zh-cn.translated'
  },
  {
    value: 'zh-tw',
    label: 'languages.zh-tw.original',
    translated: 'languages.zh-tw.translated'
  }
]
