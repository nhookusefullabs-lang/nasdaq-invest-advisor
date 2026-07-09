const SCREENS = [
  { id: 'home', label: '1. 홈/검색' },
  { id: 'recommend', label: '2. 추천 결과' },
  { id: 'simulation', label: '3. 시뮬레이션' },
  { id: 'portfolio', label: '4. 포트폴리오' },
]

export default function NavTabs({ current, onChange, selectedCount }) {
  const isEnabled = (id) => {
    if (id === 'home' || id === 'recommend') return true
    return selectedCount > 0
  }

  return (
    <nav className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
      {SCREENS.map((s) => {
        const enabled = isEnabled(s.id)
        const active = current === s.id
        return (
          <button
            key={s.id}
            type="button"
            disabled={!enabled}
            onClick={() => enabled && onChange(s.id)}
            className={[
              'px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
              active
                ? 'border-blue-600 text-blue-700 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-800',
              !enabled && 'opacity-40 cursor-not-allowed hover:text-gray-500',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {s.label}
          </button>
        )
      })}
    </nav>
  )
}
