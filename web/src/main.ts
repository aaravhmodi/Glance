import './style.css'

if (new URLSearchParams(location.search).has('smoke')) {
  document.querySelector('#app')!.remove()
  await import('./smoke')
} else {
  document.querySelector('#out')!.remove()
  const { startApp } = await import('./app')
  await startApp()
}
