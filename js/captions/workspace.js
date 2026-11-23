import {
  defaultCaptions,
  safeCaptions,
  PRESETS,
  correctCaption,
  estimatedWords,
  srt
} from './model.js';
import { CAPTION_FONTS } from './fonts.js';
import { ensureCaptionFont } from './render.js';
export function captionWorkspace(
  host,
  { video, range, onChange, onGenerate, download }
) {
  let state = defaultCaptions(),
    page = 0;
  const pageSize = 40;
  host.innerHTML = `<h2>Captions <span class="pill">DEVELOPMENT</span></h2><p class="muted">Generate English captions for the selected range. Your audio stays on this device. First use downloads roughly 100 MB of model and processing files; allow several minutes on a desktop. Review names and timing before exporting.</p><div class="actions"><button type="button" id="generateCaptions">Generate captions</button><button type="button" id="cancelCaptions" hidden>Cancel transcription</button><button type="button" id="addCaption">Add at playhead</button><button type="button" id="downloadSrt">Download range SRT</button></div><p id="captionStatus" role="status" aria-live="polite"></p><progress id="captionProgress" hidden aria-label="Transcription progress"></progress><label class="check-label"><input type="checkbox" id="captionEnabled"> Show captions in preview and MP4 exports</label><div class="caption-style"></div><p class="muted">Times below are seconds in the source video. Changing timing or the number of words estimates word timing again. SRT covers the selected range and starts at zero; animation appears in MP4 only.</p><div class="actions"><button type="button" id="captionPrevious">Previous captions</button><output id="captionPage"></output><button type="button" id="captionNext">Next captions</button></div><div class="caption-rows"></div>`;
  const find = (s) => host.querySelector(s),
    message = (text) => (find('#captionStatus').textContent = text);
  const styleHost = find('.caption-style'),
    rows = find('.caption-rows');
  function apply(next, dirty = true, duration = video.duration) {
    const valid = safeCaptions(
      next,
      Number.isFinite(duration) ? duration : Infinity
    );
    state = valid;
    render();
    if (state.enabled)
      ensureCaptionFont(state.style.font)
        .then(() => onChange(false))
        .catch((e) => message(`Font could not load: ${e.message}`));
    onChange(dirty);
  }
  const controls = [
    [
      'preset',
      'Animation preset',
      'select',
      Object.entries(PRESETS).map(([key, v]) => [key, v.label])
    ],
    ['font', 'Font', 'select', CAPTION_FONTS.map((f) => [f.key, f.label])],
    ['fontSize', 'Font size (%)', 'number', 3, 12, 0.5],
    ['color', 'Text color', 'color'],
    ['highlight', 'Highlight color', 'color'],
    ['outline', 'Outline color', 'color'],
    ['outlineWidth', 'Outline thickness', 'number', 0, 0.2, 0.01],
    ['shadow', 'Drop shadow', 'checkbox'],
    ['x', 'Horizontal position (%)', 'number', 5, 95, 1],
    ['y', 'Vertical position (%)', 'number', 5, 95, 1],
    ['maxWords', 'Words per group', 'number', 1, 12, 1],
    ['intensity', 'Animation intensity', 'number', 0, 2, 0.1],
    ['speed', 'Animation speed', 'number', 0.5, 2, 0.1]
  ];
  for (const [key, label, type, values, max, step] of controls) {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    const el = document.createElement(type === 'select' ? 'select' : 'input');
    el.id = 'caption-' + key;
    if (type === 'select')
      for (const [value, text] of values) el.add(new Option(text, value));
    else {
      el.type = type;
      if (type === 'number') {
        el.min = values;
        el.max = max;
        el.step = step;
      }
    }
    el.addEventListener('change', () => {
      try {
        const value =
          type === 'checkbox'
            ? el.checked
            : type === 'number'
              ? Number(el.value)
              : el.value;
        const style =
          key === 'preset'
            ? { preset: value, ...PRESETS[value] }
            : { ...state.style, [key]: value };
        apply({ ...state, style });
      } catch (e) {
        message(e.message);
        render();
      }
    });
    wrap.append(el);
    styleHost.append(wrap);
  }
  function button(text, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.onclick = () => {
      try {
        fn();
      } catch (e) {
        message(e.message);
      }
    };
    return b;
  }
  function updateSegments(segments) {
    apply({ ...state, enabled: true, segments });
  }
  function render() {
    find('#captionEnabled').checked = state.enabled;
    for (const [key, , ,] of controls) {
      const el = find('#caption-' + key);
      if (el.type === 'checkbox') el.checked = state.style[key];
      else el.value = state.style[key];
    }
    rows.replaceChildren();
    page = Math.min(
      page,
      Math.max(0, Math.ceil(state.segments.length / pageSize) - 1)
    );
    find('#captionPrevious').disabled = page === 0;
    find('#captionNext').disabled =
      (page + 1) * pageSize >= state.segments.length;
    find('#captionPage').textContent = state.segments.length
      ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, state.segments.length)} of ${state.segments.length}`
      : 'No captions yet';
    state.segments
      .slice(page * pageSize, (page + 1) * pageSize)
      .forEach((cue, localIndex) => {
        const index = page * pageSize + localIndex;
        const row = document.createElement('div');
        row.className = 'caption-row';
        const label = document.createElement('strong');
        label.textContent = `${index + 1} · ${cue.timing === 'word' ? 'Model word timing' : 'Estimated word timing'}`;
        const text = document.createElement('textarea');
        text.value = cue.text;
        text.maxLength = 800;
        text.setAttribute('aria-label', `Caption ${index + 1} text`);
        const start = document.createElement('input'),
          end = document.createElement('input');
        for (const [el, value, name] of [
          [start, cue.start, 'start'],
          [end, cue.end, 'end']
        ]) {
          el.type = 'number';
          el.min = 0;
          el.step = 0.01;
          el.value = value.toFixed(3);
          el.setAttribute('aria-label', `Caption ${index + 1} ${name} seconds`);
        }
        const save = () => {
          try {
            const next = state.segments.slice();
            next[index] = correctCaption(
              cue,
              text.value,
              Number(start.value),
              Number(end.value)
            );
            updateSegments(next);
          } catch (e) {
            message(e.message + ' Edit was not applied.');
          }
        };
        text.onchange = start.onchange = end.onchange = save;
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.append(
          button('Jump', () => {
            video.pause();
            video.currentTime = cue.start;
            video.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }),
          button('Split at playhead', () => {
            const t = video.currentTime;
            if (t <= cue.start || t >= cue.end)
              throw Error('Move the playhead inside this caption to split it.');
            const n = cue.words.findIndex((w) => w.start >= t);
            if (n < 1) throw Error('Split between words.');
            const a = cue.words
                .slice(0, n)
                .map((w) => w.text)
                .join(' '),
              b = cue.words
                .slice(n)
                .map((w) => w.text)
                .join(' ');
            const next = state.segments.slice();
            next.splice(
              index,
              1,
              correctCaption(cue, a, cue.start, t),
              correctCaption(cue, b, t, cue.end)
            );
            updateSegments(next);
          }),
          button('Merge next', () => {
            const next = state.segments.slice(),
              other = next[index + 1];
            if (!other) throw Error('There is no following caption.');
            next.splice(
              index,
              2,
              correctCaption(
                cue,
                cue.text + ' ' + other.text,
                cue.start,
                other.end
              )
            );
            updateSegments(next);
          }),
          button('Delete', () =>
            updateSegments(state.segments.filter((_, i) => i !== index))
          )
        );
        row.append(label, start, end, text, actions);
        rows.append(row);
      });
  }
  find('#captionPrevious').onclick = () => {
    page--;
    render();
  };
  find('#captionNext').onclick = () => {
    page++;
    render();
  };
  find('#captionEnabled').onchange = (e) =>
    apply({ ...state, enabled: e.target.checked });
  find('#generateCaptions').onclick = onGenerate;
  find('#addCaption').onclick = () => {
    try {
      if (!Number.isFinite(video.duration)) throw Error('Load a video first.');
      const start = video.currentTime,
        end = Math.min(video.duration, start + 2);
      updateSegments([
        ...state.segments,
        {
          start,
          end,
          text: 'New caption',
          timing: 'estimated',
          words: estimatedWords('New caption', start, end)
        }
      ]);
    } catch (e) {
      message(e.message);
    }
  };
  find('#downloadSrt').onclick = () => {
    try {
      const { start, end } = range();
      const text = srt(state.segments, start, end);
      if (!text) throw Error('No captions in this range.');
      download(
        new Blob([text], { type: 'application/x-subrip' }),
        'pursuit-captions.srt'
      );
    } catch (e) {
      message(e.message);
    }
  };
  render();
  return {
    get: () => state,
    refresh: render,
    set: (next, duration) => apply(next || defaultCaptions(), false, duration),
    message,
    progress: (text, working) => {
      message(text);
      find('#captionProgress').hidden = !working;
      find('#cancelCaptions').hidden = !working;
    },
    replaceRange: (segments, start, end) =>
      apply({
        ...state,
        enabled: true,
        segments: [
          ...state.segments.filter((c) => c.end <= start || c.start >= end),
          ...segments
        ]
      })
  };
}
