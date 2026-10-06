// Drive the full floors-v3 batch unattended: for each family × recipe, stage 1
// (windows) → stage 2 (compose, via collect) → stage 3 (wrapfix) → final.
//
// State lives entirely on the filesystem (jobs.json + staging artefacts), so this is
// safe to kill and restart at any point. At most MAX_INFLIGHT families have GPU work
// queued at once, in order — smallest master first, so verdicts start arriving early.
//
// Prints one line per state change; "FAMILY-DONE <slug>" when both recipes have finals.
//
// node run-floors-v3.mjs [--recipes light400 | base400 | base400,light400]
//
// Run as phases: a light400-only pass gets every family to Gate 1 in hours; the slow
// base400 pass runs after, and FAMILY-DONE fires per phase (finals for THIS run's
// recipes), so mockups can go out per phase.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { arg } from './lib.mjs';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'staging', 'floors-v3');
const FAMILIES = String(arg('families', 'cobble,packed-earth,plank,cave-rock,grass')).split(',');
const RECIPES = String(arg('recipes', 'base400,light400')).split(',');
const MAX_INFLIGHT = 2;
const TICK_MS = 5 * 60 * 1000;

const jobs = () =>
  fs.existsSync(path.join(OUT, 'jobs.json'))
    ? JSON.parse(fs.readFileSync(path.join(OUT, 'jobs.json'), 'utf8'))
    : [];

const submitted = (fam, recipe, wrapfix) =>
  jobs().some((j) => j.family === fam && (wrapfix ? j.recipe === `${recipe}-wrapfix` : j.recipe === recipe));

const composedDone = (fam, recipe) => fs.existsSync(path.join(OUT, `${fam}-${recipe}-composed.png`));
const finalDone = (fam, recipe) => fs.existsSync(path.join(OUT, `${fam}-${recipe}.png`));

function run(script, ...args) {
  return execFileSync(process.execPath, [path.join(HERE, script), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const announced = new Set();
function say(line) {
  if (announced.has(line)) return;
  announced.add(line);
  console.log(line);
}

async function tick() {
  // Collect anything the GPU has finished; compose/wrapfix assembly happens in here.
  try {
    run('collect-upscale.mjs');
  } catch (e) {
    say(`COLLECT-ERROR ${String(e.message).slice(0, 120)}`);
  }

  let inflight = 0;
  for (const fam of FAMILIES) {
    const famDone = RECIPES.every((r) => finalDone(fam, r));
    if (famDone) {
      say(`FAMILY-DONE ${fam}`);
      continue;
    }

    const started = RECIPES.some((r) => submitted(fam, r, false));
    if (started) inflight++;

    for (const recipe of RECIPES) {
      if (finalDone(fam, recipe)) continue;

      if (!submitted(fam, recipe, false)) {
        if (inflight > MAX_INFLIGHT || (!started && inflight >= MAX_INFLIGHT)) continue;
        run('upscale-floors.mjs', '--family', fam, '--recipe', recipe);
        if (!started) inflight++;
        say(`STAGE1-QUEUED ${fam} ${recipe}`);
      } else if (composedDone(fam, recipe) && !submitted(fam, recipe, true)) {
        run('upscale-floors.mjs', '--family', fam, '--recipe', recipe, '--wrapfix');
        say(`WRAPFIX-QUEUED ${fam} ${recipe}`);
      }
    }
  }

  if (FAMILIES.every((f) => RECIPES.every((r) => finalDone(f, r)))) {
    say('ALL-FAMILIES-DONE');
    process.exit(0);
  }
}

await tick();
setInterval(tick, TICK_MS);
