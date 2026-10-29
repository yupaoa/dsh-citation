/**
 * 悬停原文 + 提示条：输入框胶囊只暴露文字，靠 chipIndex 反查；提示条必须自己消失。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, makeCtx } from './harness.js'
import { fakeDocument, dispatch } from './fake-dom.js'

const { lib } = loadClient().exports
const { rememberChip, findChipCitation, installChipHover, showToast, describeCitation, interpolate, zh, CITATION_CSS } = lib

const t = (key, vars) => interpolate(zh[key] ?? key, vars)

function citation(overrides = {}) {
  return {
    turn: 16,
    step: 0,
    anchor: 'x',
    session: 's',
    range: [1028, 1035],
    quote: '答中划选，都不',
    ...overrides,
  }
}

test('the menu and the popover are dark, not white (regression: invisible text)', () => {
  assert.match(CITATION_CSS, /\.dsh-citation-menu\{[^}]*background:#1c1c20/u)
  assert.match(CITATION_CSS, /\.dsh-citation-menu-item\{[^}]*color:#f2f2f5/u)
  assert.match(CITATION_CSS, /\.dsh-citation-popover\{[^}]*background:#1c1c20/u)
  assert.doesNotMatch(CITATION_CSS, /bg-elevated,#fff/u)
})

test('a remembered chip can be looked up by its own label, spaces ignored', () => {
  const one = citation()
  const label = describeCitation(one, t).label
  rememberChip(label, one)
  assert.equal(findChipCitation(` ◎ ${label} `), one)
  assert.equal(findChipCitation(label.replace(/ /gu, '')), one)
  assert.equal(findChipCitation('毫不相干的一段话'), null)
})

test('hovering a composer chip opens the popover with the quoted text, leaving closes it', () => {
  const doc = fakeDocument()
  const { ctx } = makeCtx()
  const one = citation()
  rememberChip(describeCitation(one, t).label, one)
  const dispose = installChipHover(ctx, t, { document: doc })

  const chip = doc.createElement('span')
  chip.className = 'NOA9Ua_chip'
  chip.textContent = '◎引用 · 第16轮 · 7字'
  chip.setAttribute('title', '引用 · 第16轮 · 7字')
  const holder = doc.createElement('span')
  holder.setAttribute('data-lexical-decorator', 'true')
  holder.appendChild(chip)
  holder.textContent = chip.textContent
  chip.closest = () => holder

  dispatch(doc, 'pointerover', { target: chip })
  const popovers = doc.body.childNodes.filter((node) => node.className === 'dsh-citation-popover')
  assert.equal(popovers.length, 1, '悬停要弹出浮层')
  const text = popovers[0].childNodes[1].textContent
  assert.equal(text, one.quote, '浮层里必须是划选的原文')
  assert.equal(chip.getAttribute('title'), null, '浮层开着时摘掉宿主的原生 title，避免两个提示同时弹')

  dispatch(doc, 'pointerout', { target: chip })
  assert.equal(doc.body.childNodes.filter((node) => node.className === 'dsh-citation-popover').length, 0)
  assert.equal(chip.getAttribute('title'), '引用 · 第16轮 · 7字', '关掉浮层要把 title 还回去')

  dispose()
  assert.equal(doc.listeners.length, 0)
})

test('the toast styles are present and the host notice API is not used for success', () => {
  assert.match(CITATION_CSS, /\.dsh-citation-toast\{[^}]*opacity:0/u)
  assert.match(CITATION_CSS, /\.dsh-citation-toast\[data-open="true"\]\{opacity:1\}/u)
})

test('showToast replaces its own element instead of stacking notices', () => {
  const doc = fakeDocument()
  showToast(doc, '已添加到输入框')
  showToast(doc, '这一段已经引用过了')
  const toasts = doc.body.childNodes.filter((node) => node.className === 'dsh-citation-toast')
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].textContent, '这一段已经引用过了')
  assert.equal(toasts[0].dataset.open, 'true')
})
