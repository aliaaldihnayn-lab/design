// Counts its runs in figma.clientStorage, which outlives the plugin, and tries the network its
// manifest denies it; it reports both and closes.
async function main() {
  const runs = ((await figma.clientStorage.getAsync('runs')) ?? 0) + 1
  await figma.clientStorage.setAsync('runs', runs)
  let network = 'open'
  try {
    await fetch('https://example.com/')
  } catch {
    network = 'blocked'
  }
  figma.closePlugin(`Run ${runs}, network ${network}`)
}
void main()
