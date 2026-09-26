import type { Appearance } from './model';

/** Deliberately illustrated sample clothing, independent of game rendering. */
export function Figure({ appearance, compact = false }: { appearance: Appearance; compact?: boolean }) {
  const top = appearance.top?.color || '#d9d2c8';
  const bottom = appearance.bottom?.color || '#c4c0cc';
  const shoe = appearance.shoes?.color || '#aeaaa7';
  const hair = appearance.hair?.color || '#65554e';
  const skin = appearance.body?.color || '#e5c9b6';
  const trousers = appearance.bottom?.id.includes('trouser');
  const shortHair = appearance.hair?.id.includes('short');
  const jacket = appearance.outer?.color;
  return <svg className={`figure ${compact ? 'figure-compact' : ''}`} viewBox="0 0 220 350" aria-hidden="true">
    <ellipse cx="110" cy="331" rx="54" ry="8" fill="currentColor" opacity=".06" />
    <path d={shortHair ? 'M83 55 Q78 19 110 18 Q144 20 138 64 L129 76 H90Z' : 'M83 59 Q77 20 110 18 Q143 19 138 60 L148 135 Q110 151 73 134Z'} fill={hair} />
    <path d="M101 64 L101 91 L119 91 L119 64" fill={skin} />
    <ellipse cx="110" cy="48" rx="24" ry="30" fill={skin} />
    <path d="M85 46 Q83 16 111 19 Q141 20 136 49 Q129 43 121 32 Q109 48 85 46Z" fill={hair} />
    <path d="M87 90 Q77 87 74 106 L60 178 Q55 194 60 204 Q65 211 70 201 L76 181 L92 117Z" fill={skin} />
    <path d="M133 90 Q143 87 146 106 L160 178 Q165 194 160 204 Q155 211 150 201 L144 181 L128 117Z" fill={skin} />
    <path d="M84 179 L89 309 L105 309 L110 211 L115 309 L131 309 L136 179Z" fill={skin} />
    {trousers ? <g>
      <path d="M82 163 L138 163 L133 302 L113 302 L109 204 L106 302 L87 302Z" fill={bottom} />
      <path d="M109 174 L109 204 M90 180 L94 280 M129 180 L123 280" fill="none" stroke="#fff" strokeOpacity=".16" strokeWidth="1.5" />
    </g> : <g>
      <path d="M84 158 L136 158 L155 241 Q112 258 65 241Z" fill={bottom} />
      <path d="M93 175 L82 237 M108 175 L103 245 M122 175 L129 242 M131 179 L145 237" stroke="#fff" strokeOpacity=".16" strokeWidth="1.5" fill="none" />
      <path d="M66 240 Q108 254 154 240" stroke="#000" strokeOpacity=".05" strokeWidth="2" fill="none" />
    </g>}
    <path d="M95 85 Q110 97 125 85 L140 94 L151 144 L136 148 L129 119 L135 174 Q110 181 85 174 L90 119 L83 148 L69 144 L80 94Z" fill={top} />
    <path d="M98 86 Q110 100 122 86 M85 173 Q110 180 135 173" stroke="#000" strokeOpacity=".11" strokeWidth="1.5" fill="none" />
    {appearance.top?.id.includes('knit') && <g stroke="#fff" strokeOpacity=".16" strokeWidth="1.2"><path d="M97 103 L97 169 M104 103 L104 172 M111 105 L111 173 M118 103 L118 172 M125 102 L125 170" /></g>}
    {jacket && <g>
      <path d="M94 83 L108 103 L101 192 L78 186 L82 132 L72 168 L58 162 L76 99Z" fill={jacket} />
      <path d="M126 83 L112 103 L119 192 L142 186 L138 132 L148 168 L162 162 L144 99Z" fill={jacket} />
      <path d="M94 84 L89 108 L102 125 L108 102 M126 84 L131 108 L118 125 L112 102" stroke="#fff" strokeOpacity=".28" strokeWidth="1.8" fill="none" />
      <path d="M83 168 L98 170 M122 170 L137 168" stroke="#000" strokeOpacity=".12" strokeWidth="1.5" />
      <circle cx="104" cy="141" r="1.6" fill="#fff" opacity=".4" /><circle cx="102" cy="164" r="1.6" fill="#fff" opacity=".4" />
    </g>}
    <path d="M87 299 L106 299 L106 321 Q99 328 77 324 Q74 320 87 313Z" fill={shoe} />
    <path d="M114 299 L133 299 L133 313 Q146 320 143 324 Q121 328 114 321Z" fill={shoe} />
    <path d="M79 324 L105 324 M115 324 L142 324" stroke="#fff" strokeOpacity=".36" strokeWidth="2.5" />
    <path d="M87 311 L99 313 M121 313 L133 311" stroke="#fff" strokeOpacity=".38" strokeWidth="1.5" />
    <path d="M97 61 Q110 67 123 61" stroke="#ba8e7a" strokeOpacity=".28" strokeWidth="1.1" fill="none" />
  </svg>;
}
