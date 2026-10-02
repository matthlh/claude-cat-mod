import type { ClientModule } from 'claude-code'

// An invisible layer over the lane: it reports where it was clicked, and the
// hooks module decides whether that was the cat (a pet) or the floor (the
// cat runs over to look).
const Petter: ClientModule = (_props, surface) => {
  if (surface.state === undefined) {
    surface.onPointer(e => {
      if (e.type === 'down' && (e.button ?? 'left') === 'left') {
        surface.post({ x: e.fine?.x ?? e.x + 0.5, columns: surface.columns })
      }
    })
    surface.setState(true)
  }
  const { Box } = surface.elements
  return <Box width="100%" height="100%" />
}

export default Petter
