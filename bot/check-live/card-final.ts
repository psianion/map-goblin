import { readFileSync, writeFileSync } from 'node:fs'
import { renderCharacterCard } from '../src/render/card-kit'
const uri = 'data:image/png;base64,' + readFileSync('data/portraits/2.png').toString('base64')
writeFileSync('test-output/card-final.png', await renderCharacterCard({ name: 'KNeel', className: 'PaliLock', level: 9, campaignName: 'test01', portraitDataUri: uri, lastPlayed: Date.parse('2026-09-17') }))
writeFileSync('test-output/card-final-nopic.png', await renderCharacterCard({ name: 'Thalor Featherstonehaugh', className: 'Ranger', level: 3, campaignName: 'test01' }))
console.log('rendered')
