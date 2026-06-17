/**
 * sync-core-mechanic.js — Sync core effects from tags.effect to coreMechanic
 *
 * Ensures every identity that has a core effect (烧伤/流血/震颤/破裂/沉沦/呼吸/充能)
 * in tags.effect also has it in coreMechanic.
 *
 * Run: node tools/sync-core-mechanic.js
 */

const fs = require('fs');
const path = require('path');

const CORE_EFFECTS = ['烧伤', '流血', '震颤', '破裂', '沉沦', '呼吸法', '充能'];

function syncIdentity(identity, index) {
  const effects = identity.tags?.effect || [];
  const current = identity.coreMechanic || [];

  const missing = effects.filter(e => CORE_EFFECTS.includes(e) && !current.includes(e));

  if (missing.length > 0) {
    const before = [...current];
    identity.coreMechanic = [...current, ...missing];
    console.log(`  #${index + 1} ${identity.name}: +${missing.join(', ')}  [${before.join(', ')}] → [${identity.coreMechanic.join(', ')}]`);
    return true;
  }
  return false;
}

function main() {
  // Priority: userData/data/identities.json, then bundled data/identities.json
  const userDataPath = path.join(
    process.env.APPDATA || path.join(process.env.HOME, 'AppData', 'Roaming'),
    'limbus-command-simulator', 'data', 'identities.json'
  );
  const bundledPath = path.join(__dirname, '..', 'data', 'identities.json');

  let sourcePath;
  if (fs.existsSync(userDataPath)) {
    sourcePath = userDataPath;
    console.log(`Using userData: ${userDataPath}`);
  } else {
    sourcePath = bundledPath;
    console.log(`Using bundled data: ${bundledPath}`);
  }

  const raw = fs.readFileSync(sourcePath, 'utf8');
  const identities = JSON.parse(raw);

  console.log(`\nSyncing ${identities.length} identities...\n`);

  let changed = 0;
  for (let i = 0; i < identities.length; i++) {
    if (syncIdentity(identities[i], i)) {
      changed++;
    }
  }

  if (changed > 0) {
    // Always save to userData
    const userDataDir = path.dirname(userDataPath);
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    fs.writeFileSync(userDataPath, JSON.stringify(identities, null, 2), 'utf8');
    console.log(`\n✓ Done. ${changed} identities updated. Saved to: ${userDataPath}`);
  } else {
    console.log('\n✓ All identities already synced — no changes needed.');
  }
}

main();
