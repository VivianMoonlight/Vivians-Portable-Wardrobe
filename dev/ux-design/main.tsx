import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Figure } from './Figure';
import { outfits, initialAppearance, buildPreview, clothingSlots, allSlots, slotLabels, type Appearance, type Slot, type Scope } from './model';
import './styles.css';

function Icon({ name, size = 20 }: { name: 'hanger' | 'search' | 'close' | 'heart' | 'check' | 'arrow' | 'chevron' | 'undo' | 'spark' | 'sliders'; size?: number }) {
  const paths = {
    hanger: <><path d="M9 6a3 3 0 0 1 6 0c0 2-3 2-3 4v2L3 17a1 1 0 0 0 .5 2h17a1 1 0 0 0 .5-2l-9-5" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    heart: <path d="M20 5c-3-3-7-1-8 2-1-3-5-5-8-2C0 9 4 14 12 20c8-6 12-11 8-15Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="m10 5-7 7 7 7M3 12h18" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    undo: <><path d="M3 9h11a6 6 0 1 1 0 12M3 9l5-5M3 9l5 5" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></>,
    sliders: <><path d="M4 7h7m4 0h5M4 17h3m4 0h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type Current = { appearance: Appearance; name: string };
type Collection = '全部' | '日常' | '正式' | '收藏';

function App() {
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState<Collection>('全部');
  const [favorites, setFavorites] = useState(() => new Set(outfits.filter(o => o.favorite).map(o => o.id)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Current>({ appearance: initialAppearance, name: '今天的穿搭' });
  const [previous, setPrevious] = useState<Current | null>(null);
  const [scope, setScope] = useState<Scope>('clothing');
  const [customSlots, setCustomSlots] = useState<Slot[]>([...clothingSlots]);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<'current' | 'preview'>('current');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [justApplied, setJustApplied] = useState(false);
  const libraryRef = useRef<HTMLDivElement>(null);
  const mirrorTitleRef = useRef<HTMLHeadingElement>(null);
  const selectedCardRef = useRef<HTMLButtonElement>(null);
  const savedScroll = useRef(0);
  const selected = outfits.find(o => o.id === selectedId) || null;
  const result = useMemo(() => selected ? buildPreview(current.appearance, selected, scope, customSlots) : { appearance: current.appearance, changes: allSlots.map(slot => ({ slot, before: current.appearance[slot], after: current.appearance[slot], action: 'keep' as const, changed: false })) }, [current.appearance, selected, scope, customSlots]);
  const changes = result.changes.filter(c => c.changed);
  const kept = result.changes.filter(c => !c.changed);
  const replaceCount = changes.filter(c => c.action === 'replace').length;
  const clearCount = changes.filter(c => c.action === 'clear').length;
  const previewMatches = Boolean(selected) && !changes.length && (scope !== 'custom' || customSlots.length > 0);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleOutfits = outfits.filter(o => (collection === '全部' || (collection === '收藏' ? favorites.has(o.id) : o.collection === collection)) && (!normalizedQuery || [o.name, o.path, ...o.tags].join(' ').toLocaleLowerCase().includes(normalizedQuery)));
  const shownAppearance = view === 'current' ? current.appearance : result.appearance;

  function selectOutfit(id: string) {
    savedScroll.current = libraryRef.current?.scrollTop || 0;
    setSelectedId(id);
    setView('preview');
    setJustApplied(false);
    setMobileDetail(true);
    if (window.matchMedia('(max-width: 760px)').matches) requestAnimationFrame(() => mirrorTitleRef.current?.focus());
  }
  function returnToLibrary() {
    setMobileDetail(false);
    requestAnimationFrame(() => {
      if (libraryRef.current) libraryRef.current.scrollTop = savedScroll.current;
      selectedCardRef.current?.focus({ preventScroll: true });
    });
  }
  function resetFilters() { setQuery(''); setCollection('全部'); }
  function toggleFavorite(id: string) {
    setFavorites(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function chooseScope(next: Scope) { setScope(next); setView('preview'); setJustApplied(false); }
  function applyOutfit() {
    if (!selected || view !== 'preview' || !changes.length) return;
    setPrevious(current);
    setCurrent({ appearance: result.appearance, name: scope === 'custom' ? `${selected.name} · 局部搭配` : selected.name });
    setJustApplied(true);
    setView('current');
    setAnnouncement(`已换装：${replaceCount} 个部位替换${clearCount ? `，${clearCount} 个部位清空` : ''}。`);
  }
  function undo() {
    if (!previous) return;
    setCurrent(previous);
    setView('current');
    setPrevious(null);
    setJustApplied(false);
    setAnnouncement('已恢复上一次穿搭。');
  }
  const changeText = changes.length ? `${replaceCount ? `替换 ${replaceCount} 项` : ''}${replaceCount && clearCount ? ' · ' : ''}${clearCount ? `清空 ${clearCount} 项` : ''}` : '没有需要更换的部位';

  return <div className={`app ${mobileDetail ? 'mobile-detail' : ''}`}>
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><Icon name="hanger" size={25} /></span><div><strong>Vivian’s Wardrobe</strong><span className="brand-caption">随身衣橱</span></div></div>
      <span className="design-badge"><span />交互设计稿 · 示例数据</span>
    </header>
    <main className="workspace">
      <section className="library" aria-label="我的衣橱">
        <div className="library-top">
          <div className="section-heading"><div><p className="eyebrow">YOUR WARDROBE</p><h1>今天，想穿哪一套？</h1></div><span className="outfit-total">{outfits.length} 套穿搭</span></div>
          <div className="search-field"><Icon name="search" size={19} /><input aria-label="搜索名称、标签或路径" placeholder="搜索名称、标签或路径…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}<kbd>/</kbd></div>
          <div className="collections" aria-label="筛选穿搭">{(['全部', '日常', '正式', '收藏'] as Collection[]).map(c => <button key={c} className={collection === c ? 'collection active' : 'collection'} aria-pressed={collection === c} onClick={() => setCollection(c)}>{c === '收藏' && <Icon name="heart" size={14} />}{c}{c === '全部' && <span>{outfits.length}</span>}</button>)}</div>
        </div>
        <div className="library-scroll" ref={libraryRef}>
          <div className="results-caption"><span>{query || collection !== '全部' ? `找到 ${visibleOutfits.length} 套穿搭` : '为每一种心情，留一套喜欢的穿搭。'}</span><span className="click-hint">单击试穿</span></div>
          {visibleOutfits.length ? <div className="outfit-grid">{visibleOutfits.map(outfit => <article className={`outfit-card ${selectedId === outfit.id ? 'selected' : ''}`} key={outfit.id}>
            <button className="outfit-select" ref={selectedId === outfit.id ? selectedCardRef : undefined} aria-label={`试穿 ${outfit.name}`} aria-pressed={selectedId === outfit.id} onClick={() => selectOutfit(outfit.id)}>
              <div className={`outfit-image tone-${outfits.indexOf(outfit) % 6}`}><span className="outfit-number">0{outfits.indexOf(outfit) + 1}</span><Figure appearance={outfit.slots} compact />{selectedId === outfit.id && <span className="selected-pill"><Icon name="check" size={12} />{previewMatches ? '与当前一致' : '试穿中'}</span>}</div>
              <div className="card-copy"><h2>{outfit.name}</h2><span className="card-path">{outfit.path}</span><div className="card-tags">{outfit.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</div></div>
            </button>
            <button className={`favorite ${favorites.has(outfit.id) ? 'is-favorite' : ''}`} aria-label={`${favorites.has(outfit.id) ? '取消收藏' : '收藏'} ${outfit.name}`} aria-pressed={favorites.has(outfit.id)} onClick={() => toggleFavorite(outfit.id)}><Icon name="heart" size={17} /></button>
          </article>)}</div> : <div className="empty-state"><span className="empty-icon"><Icon name="search" size={28} /></span><h2>还没找到这套穿搭</h2><p>试试“针织”“通勤”，或查看全部衣橱。</p><button className="secondary-button" onClick={resetFilters}>清除筛选，查看全部</button></div>}
          <p className="library-footnote"><span />选中的穿搭会留在右侧，直到你换一套。</p>
        </div>
      </section>
      <aside className="fitting-room" aria-label="试衣间">
        <div className="fitting-scroll">
          <button className="back-button" onClick={returnToLibrary}><Icon name="arrow" size={18} />返回衣橱</button>
          <div className="fitting-heading"><div><p className="eyebrow">FITTING ROOM</p><h2 ref={mirrorTitleRef} tabIndex={-1}>{view === 'current' ? current.name : selected?.name}</h2></div><span className={`preview-status ${previewMatches || view === 'current' ? 'status-done' : ''}`}><span />{view === 'current' ? '当前穿着' : previewMatches ? '与当前一致' : '试穿中'}</span></div>
          <div className="mirror">
            <div className="mirror-switch" aria-label="对照穿搭"><button aria-pressed={view === 'current'} className={view === 'current' ? 'active' : ''} onClick={() => setView('current')}>当前穿着</button><button disabled={!selected} aria-pressed={view === 'preview'} className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>试穿效果</button></div>
            <div className="mirror-lines" aria-hidden="true"><span /><span /><span /></div>
            <Figure appearance={shownAppearance} />
            <div className="mirror-label"><span>{view === 'current' ? justApplied ? '已穿上，今天就这样出发' : '正在穿着的搭配' : previewMatches ? '与当前穿搭一致' : '尚未穿上'}</span><small>{!selected ? '从左侧选一套，开始试穿' : view === 'current' ? '切到试穿效果，继续比较' : scope === 'clothing' ? '保留当前发型与身体' : scope === 'all' ? '包含这套穿搭保存的完整外观' : `只更换选中的 ${customSlots.length} 个部位`}</small></div>
            <span className="illustration-note">示意人台</span>
          </div>
          {selected ? <div className="scope-section">
            <div className="scope-heading"><h3>怎么穿上这套？</h3><span>换装范围</span></div>
            <div className="scope-options">
              <button className={`scope-option ${scope === 'clothing' ? 'active' : ''}`} aria-pressed={scope === 'clothing'} onClick={() => chooseScope('clothing')}><span className="radio-dot" /><span><strong>只换服装</strong><small>保留发型与身体</small></span><span className="recommended">默认</span></button>
              <button className={`scope-option ${scope === 'all' ? 'active' : ''}`} aria-pressed={scope === 'all'} onClick={() => chooseScope('all')}><span className="radio-dot" /><span><strong>整套外观</strong><small>包括发型与身体</small></span></button>
            </div>
            {scope === 'all' && <p className="scope-warning">包含发型与身体；未保存的可空部位会清空。身体只替换、不清空。</p>}
            <button className={`details-toggle ${expanded ? 'is-open' : ''}`} aria-expanded={expanded} aria-controls="slot-details" onClick={() => setExpanded(!expanded)}><span><Icon name="sliders" size={17} />{scope === 'custom' ? '已自选部位' : '选择部位'}<small>{changeText}</small></span><Icon name="chevron" size={17} /></button>
            {expanded && <div className="slot-details" id="slot-details"><div className="detail-intro"><span>勾选想要更换的部位</span><button onClick={() => { setCustomSlots(['shoes']); chooseScope('custom'); }}>只换鞋</button></div>{allSlots.map(slot => {
              const item = result.changes.find(c => c.slot === slot)!;
              const effectiveSlots: readonly Slot[] = scope === 'all' ? allSlots : scope === 'clothing' ? clothingSlots.filter(s => selected.slots[s] !== null) : customSlots;
              const checked = effectiveSlots.includes(slot);
              return <label className="slot-row" key={slot}><input type="checkbox" checked={checked} onChange={() => { setCustomSlots(checked ? effectiveSlots.filter(s => s !== slot) : [...effectiveSlots, slot]); chooseScope('custom'); }} /><span className="slot-label">{slotLabels[slot]}</span><span className="slot-item"><span>{item.before?.name || '未穿戴'}</span>{item.changed && <><span className="slot-arrow">→</span><strong>{item.after?.name || '留空'}</strong></>}</span><span className={`change-label ${item.changed ? 'changed' : ''}`}>{item.changed ? item.action === 'clear' ? '清空' : '替换' : '保留'}</span></label>;
            })}<p className="slot-note">{scope === 'clothing' ? '只替换已保存的服装，未保存的部位保留当前穿着。' : '选中部位按穿搭替换；未保存的可空部位会留空。身体只替换、不清空。'}</p></div>}
          </div> : <div className="idle-intro"><span><Icon name="hanger" size={22} /></span><h3>先选一套喜欢的</h3><p>单击穿搭即可在这里试穿。<br />可以对照当前穿着，满意后再穿上。</p></div>}
        </div>
        <div className="fitting-action">
          <div className="apply-summary"><span>{!selected ? '你的当前穿搭已准备好' : view === 'current' ? '正在查看当前穿搭' : changes.length ? changeText : justApplied ? '换装完成，一切就绪' : '这次试穿不会改变当前外观'}</span><span>{view === 'preview' && `${kept.length} 项保留`}</span></div>
          {!selected ? <button className="primary-button" disabled><Icon name="hanger" size={21} />选择一套穿搭后试穿</button> : view === 'current' ? <button className="primary-button" onClick={() => setView('preview')}>返回试穿，继续比较<Icon name="arrow" size={18} /></button> : <button className="primary-button" disabled={!changes.length} onClick={applyOutfit}><Icon name={justApplied ? 'check' : 'hanger'} size={21} />{justApplied ? '已穿上这套' : changes.length ? scope === 'custom' ? '应用选中的部位' : '穿上这套' : '无需换装'}</button>}
          <div className="feedback" role="status" aria-live="polite"><span>{announcement || '确认穿上前，你的当前穿搭不会改变。'}</span>{previous && <button onClick={undo}><Icon name="undo" size={13} />撤销换装</button>}</div>
        </div>
      </aside>
    </main>
  </div>;
}

function ShortcutWrapper() {
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        const input = document.querySelector<HTMLInputElement>('.search-field input');
        if (input && input.getClientRects().length) { event.preventDefault(); input.focus(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  return <App />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ShortcutWrapper /></React.StrictMode>);
