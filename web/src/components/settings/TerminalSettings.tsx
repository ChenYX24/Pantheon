import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import type { LocalEchoMode } from '../localEcho'
import { localEchoPreference, onLocalEchoPreference, setLocalEchoPreference } from '../localEchoPreference'
import { Section } from './parts'

export function TerminalSettings() {
  const [mode, setMode] = useState(localEchoPreference)
  useEffect(() => onLocalEchoPreference(() => setMode(localEchoPreference())), [])
  const choices: { value: LocalEchoMode; label: string }[] = [
    { value: 'auto', label: t('term.echoAuto') },
    { value: 'off', label: t('term.echoOff') },
    { value: 'on', label: t('term.echoOn') },
  ]
  return (
    <Section id="terminal" title={t('term.echoTitle')}>
      <p className="mb-3 text-vp-base leading-relaxed text-ink-2">{t('term.echoWhy')}</p>
      <fieldset>
        <legend className="sr-only">{t('term.echoTitle')}</legend>
        <div className="flex flex-col gap-1">
          {choices.map((choice) => (
            <label key={choice.value} className="flex items-center gap-2 text-vp-base text-ink">
              <input
                type="radio"
                name="terminal-echo"
                checked={mode === choice.value}
                onChange={() => setLocalEchoPreference(choice.value)}
                data-testid={`local-echo-${choice.value}`}
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-2 text-vp-sm text-ink-2">{t('term.echoPending')}</p>
    </Section>
  )
}
