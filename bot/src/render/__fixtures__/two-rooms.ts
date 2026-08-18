// Hand-cut map documents for the schematic renderer's tests and the smoke check.
//
// Deliberately not imported from the game server: the bot's contract with `GET /api/maps/:id`
// is the wire shape, not the server's types, and a test that imports the server would stop
// testing that the bot survives whatever the wire actually carries.
//
// `dmMap` is the DM's copy — the authored file, whole. `playerMap` is what the same scene
// looks like after the server's redactor when the party has explored the west hall and the
// corridor but has never set foot in the vault: the vault's floor, walls, doors, labels and
// room row are simply absent, and the full map's `frame` is stamped on so the sheet still
// shows how much is left dark. Neither is filtered by the bot.

const background = {
  id: 'bg-1',
  name: 'Background',
  type: 'background',
  visible: true,
  backgroundColor: '#101014',
  backgroundTexture: null,
}

const mapSettings = {
  name: 'Fieldstone Keep — Lower Vaults',
  gridType: 'square',
  cellScale: { value: 5, unit: 'ft' },
  ambientLight: '#8a8f98',
}

const westHall = {
  id: 'floor-west',
  name: 'West Hall floor',
  childType: 'shape',
  shapeType: 'polygon',
  visible: true,
  contours: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  ],
}

const corridor = {
  id: 'floor-corridor',
  name: 'Corridor floor',
  childType: 'shape',
  shapeType: 'rectangle',
  visible: true,
  contours: [
    [
      [10, 4],
      [12, 4],
      [12, 6],
      [10, 6],
    ],
  ],
}

/** Ring 0 is the vault, ring 1 the pillar block it is built around. */
const vault = {
  id: 'floor-east',
  name: 'Vault floor',
  childType: 'shape',
  shapeType: 'polygon',
  visible: true,
  contours: [
    [
      [12, 0],
      [22, 0],
      [22, 10],
      [12, 10],
    ],
    [
      [16, 4],
      [18, 4],
      [18, 6],
      [16, 6],
    ],
  ],
}

const pool = {
  id: 'water-1',
  name: 'Cistern pool',
  childType: 'water',
  waterType: 'lake',
  visible: true,
  contours: [
    [
      [1.5, 7],
      [4.5, 7],
      [4.5, 9],
      [1.5, 9],
    ],
  ],
}

const brazier = {
  id: 'light-1',
  name: 'Brazier',
  childType: 'light',
  visible: true,
  position: { x: 5, y: 2.5 },
  color: '#ffb066',
  radius: 6,
}

const westDoor = {
  id: 'door-west',
  name: 'Hall door',
  childType: 'door',
  visible: true,
  wallId: '',
  position: [10, 5],
  angle: 0,
  width: 2,
  style: 'single',
  state: 'closed',
  isSecret: false,
  roomA: 'west',
  roomB: 'corridor',
}

const vaultDoor = {
  id: 'door-vault',
  name: 'Vault door',
  childType: 'door',
  visible: true,
  wallId: '',
  position: [12, 5],
  angle: 0,
  width: 2,
  style: 'double',
  state: 'open',
  isSecret: false,
  roomA: 'corridor',
  roomB: 'east',
}

const secretDoor = {
  id: 'door-secret',
  name: 'Secret door',
  childType: 'door',
  visible: true,
  wallId: '',
  position: [22, 7.5],
  angle: 0,
  width: 2,
  style: 'single',
  state: 'closed',
  isSecret: true,
  roomA: 'east',
  roomB: null,
}

const vaultLabel = {
  id: 'text-1',
  name: 'Label',
  childType: 'text',
  visible: true,
  text: 'Coin piles',
  position: { x: 19.5, y: 2.2 },
  rotation: 0,
  scale: 1,
  fontSize: 0.55,
  color: '#2a2016',
  width: 3,
  height: 0.6,
}

const rooms = {
  west: { id: 'west', name: 'West Hall', boundary: westHall.contours[0], centroid: [5, 5], area: 100, isPathway: false },
  corridor: {
    id: 'corridor',
    name: 'Corridor',
    boundary: corridor.contours[0],
    centroid: [11, 5],
    area: 4,
    isPathway: true,
  },
  east: { id: 'east', name: 'East Vault', boundary: vault.contours[0], centroid: [17, 8], area: 96, isPathway: false },
}

const style = {
  floorColor: '#F1ECDF',
  wallColor: '#1c1917',
  wallWidth: 0.5,
  shadowEnabled: false,
  lineWidth: 0.1,
}

/** The DM's document: the authored file, prep and secrets included. */
export const dmMap = {
  version: '3.1',
  mapSettings,
  grid: { visible: true, snapDivision: 1 },
  customImages: {},
  prep: { triggers: [{ id: 'trap-1', name: 'Pressure plate' }] },
  layers: [
    background,
    {
      id: 'layer-1',
      name: 'Lower Vaults',
      type: 'dungeon',
      visible: true,
      children: [westHall, corridor, vault, pool, brazier, westDoor, vaultDoor, secretDoor, vaultLabel],
      standaloneWalls: [
        {
          id: 'wall-partition',
          points: [
            [17, 0],
            [17, 3.5],
          ],
          wallType: 'normal',
          direction: 'both',
          color: '#1c1917',
          width: 0.4,
          roughness: 0,
        },
      ],
      mergedFloor: null,
      style,
      rooms: [rooms.west, rooms.corridor, rooms.east],
      roomNameOverrides: { east: 'Vault of Coins' },
    },
  ],
}

/** The same scene as the party holds it: no prep, no vault, and the full map's frame. */
export const playerMap = {
  version: '3.1',
  mapSettings,
  grid: { visible: true, snapDivision: 1 },
  customImages: {},
  frame: { minX: 0, minY: 0, maxX: 22, maxY: 10 },
  layers: [
    background,
    {
      id: 'layer-1',
      name: 'Lower Vaults',
      type: 'dungeon',
      visible: true,
      children: [westHall, corridor, pool, brazier, westDoor, vaultDoor],
      standaloneWalls: [],
      mergedFloor: null,
      style,
      rooms: [rooms.west, rooms.corridor],
      roomNameOverrides: {},
    },
  ],
}

/** A live table's tokens for this scene, as the observer would hand them over. */
export const tokens = [
  { id: 't1', name: 'Zed', x: 3.5, y: 3.5, cells: 1, disposition: 'friendly' as const, hidden: false },
  { id: 't2', name: 'Borin', x: 6.5, y: 4.5, cells: 1, disposition: 'friendly' as const, hidden: false },
  { id: 't3', name: 'Ambusher', x: 8.5, y: 8, cells: 2, disposition: 'hostile' as const, hidden: true },
]
