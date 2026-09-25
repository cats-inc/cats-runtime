import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Desktop builds from 2026-04-14 until the schema-2 cutover copied the bundled factory example
 * into the Runtime config directory as `curated-model-catalogs.yaml`, refreshing it while it
 * stayed unmodified (cats-platform a5b7eaa9 and a707bb65; the seed was removed in 7101d8d1
 * without retiring existing copies). Such a copy is an app-owned factory snapshot, not operator
 * intent. Converting it would pin every scope to that old factory, and 49 of the 53 shipped
 * versions cannot convert at all.
 *
 * Frozen evidence: SHA-256 of every schema-1 `config/curated-model-catalogs.yaml.example` in this
 * repository's history, after removing a byte-order mark and normalizing CRLF to LF. Derived on
 * 2026-09-26; it covers all 18 hashes Desktop listed as legacy managed templates. Never add a
 * schema-2 factory: an operator may deliberately keep a copy of the current format.
 */
const LEGACY_FACTORY_EXAMPLE_DIGESTS: ReadonlySet<string> = new Set([
  '033a6831d64fd43eebd930a2b882aaf1f6ad3c5aff9ed6e5c446330c68285798',
  '036e115a93c3eae0f8c559499fb27882d3584f872bcd15b2d5087b1689360ce9',
  '04519fcae77681ce2bf4bd231218163fca82611a0e95cf8c52f29c767ec72b7e',
  '084c0cd9fa674cf9baa5f16b3d0c2272750d820a36a3a85333d7ae6651ea8030',
  '098544583851124dcc1b70ae5c949599251277e66ea21460191921bce00b12eb',
  '09fce54dfde816296c1966eb567742ad28750a2d34d7b5e200c2cee1250fcdb9',
  '174c2edc3128e2078a4b363cb55a5854afe063eb7a1d16be9b92513d920bdd19',
  '19ef0057aa1b5c224c4e066e510d082855c77ae1d99d8e722e236e73269e6032',
  '21c29f808c277c8f1192de2c75c5dd64027c29668c6ac5d7da68451a4d1788bb',
  '2250e6795c8939f81f8db50cb5ad152703c7271cbcfc82258572a68ffd9ccb59',
  '22d4d7d488273074528aa566e18742c00c775dc09fd433b139217417a6092b39',
  '2ce89d907681a1cd10c35fcad2db0116a451bab0cbff7e32292ed6fb652b08d5',
  '446247a85c8736576a58f519881f6364049f02baa91bd7c4e84933a1a3cee6e5',
  '45c1adbd724c2bcf87beaee468879364d21bde18a926727ce9970126496e1cb1',
  '4c0430cd2ef95eba61140e198057fc2f2a90e0f0b2ad05b44384291f9a5cbf53',
  '4d9985de1777530c01bad268732d07a0a62df82e406558444e53c1df8d43a542',
  '5da6fafbcc4162e2b2cb404a68dd40959aa3d76175216d74fcbad53af5f23094',
  '5f409b315aca5569568a05a0ecad3706cbb077bcfa316a2e3abeacb572305869',
  '61114d3f0e8ac06672cfe160c4fbef4567db52270b0a33fbbca18f5f4486ed79',
  '61eb905d6967d20b74056697ca58083685be73a69648371194f77cb6f853cc01',
  '68daa69e024fa457641bd8be823ee5738eb86c9926bb5a9d6a5bbf83e6c82563',
  '6bfc442b32c35b1654411f4cc09ee4697f29dbb79aa0a18ef81dd5b8b900392a',
  '6ca6e651dda812f93fcff826c21c0249dcc11c2884adff33ba45e418886c20a1',
  '6dac5ab4dc6b75ea36d247ebe99abb391935cf58c934e116b66ac5203d4cc24a',
  '749083d483fea9f0e38b138183b5cab3d56c289ebd3acddde9c059e02116fc81',
  '7b4a1ff8a3575b197b42433a5fefec5eb9fd001c84368625d6586ce7b88e618d',
  '7f20c470e91dd8b05f75d2d9d024326a306a57484182f34a29711e6570371c12',
  '843f5b673519d2e2be5022089d7b673559ae9a73c6c176b8e4d797c674eb3de7',
  '85104967b99b1c4e006c781712237fade6a93c2598df1d5107a5706679617855',
  '8b7484427ef9638ef3f0d5a594ab1171e6ed66f5ceb1b5bd377e565877e3b0bf',
  '8ff14d33427db506af701598d5f00e2d31b6745dfadd4dfbbe425454687a8fe4',
  '923fa9d179293ded5635f517fa2c14f87d9c644c163b2db1ec2f38f38d1dfe5e',
  '951bd2baa0328be557db34f4e18d6086663092852840bc6ac6eb1c3bb8783d4f',
  '977b3feebbd9f808c8bdf28e43141b80c0144e06a261c8ef5da6c643c70e48eb',
  '9d59892e1467cfc25ebca76178bcbbf4a835bc752507fc978c50bce175219af9',
  'a21d9d3c276ffd5b44791acc603c05b6b23d57fd856cd23ceabac1d4bcce6885',
  'a729484f14cf5627d032c3e5f2b49035656a246620d9e2e711aa1c946b613974',
  'aadb2b740389eacd215844b64a9a6a06a46c0ba833cfa64255af1cda7f699ba9',
  'af7ca217713399c077c46dcfedf4ef6bb62d1337f31e64b8f49aff25289aeb5b',
  'b0848d8c8e1b4602b52d070a4d779d87b2fcd4161a9007ab5809ec82da4905d1',
  'b0cb21b068b127168b1e59a245ce5322bae6c3189880cfe82d4abc77a4fe8b83',
  'b511feadc618e8867dc1bc617056f3d7f805a2b1a49e8715fe4a1930c0ce3122',
  'bb883764e88ed3045fbbe6af7a0be7b14289f942f89cbb800ad2bfbda8826bd8',
  'c5cdbcf3f5ff72d38345fee84ed1973e9a2f5d2f043d1be607c776e7b72a4875',
  'c64eada9a5e52f7ebe7481f3db16bc11aca1b5e3a62bb1124f8cf5c1b0ec4752',
  'c71d76e3a994f623c0b921c7f41b516e3cfd4ac81820d4ad65e2668ac0f7f31b',
  'c9d99fef23e0c014e315b663da43a4ad2bb813c5d82b0d3300b52a310c69da08',
  'd10facf17196468f587bc6ed8ae8c285735845415b3b1923fbcdd2d818a002e1',
  'd1a70befe2ac2f42303e83ce2e43ab4ea85518078d0931fa9cfbf2c52c958a80',
  'd76e5557f8c7bf2ab5d3c1cec410d0bd4f8a811f383f7e9c42279a3e700e95d6',
  'e5a3095ef0250d1650b9bcc05b08303e5d56a8b5b4a1529a16c81331ae268f81',
  'e79ed7703e1a61d0c1364f0248a9b795244ce899326e3910f135e68d7ca0b16e',
  'e97930dfe23f52b1a8bc00212b1587945a4ec89fb2cd61e89a1e480bdb34e205',
]);

/** Desktop's record of the template it last seeded, kept beside the Runtime config. */
const DESKTOP_SEED_STATE_FILE = '.bundled-template-seeds.json';
const DESKTOP_SEED_TEMPLATE = 'curated-model-catalogs.yaml.example';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeLineEndings(source: string): string {
  const withoutMark = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return withoutMark.replace(/\r\n/g, '\n');
}

function readDesktopSeedHash(configDirectory: string): string | undefined {
  try {
    const record = JSON.parse(readFileSync(join(configDirectory, DESKTOP_SEED_STATE_FILE), 'utf8')) as unknown;
    const entry = (record as Record<string, { sourceHash?: unknown } | undefined>)?.[DESKTOP_SEED_TEMPLATE];
    return typeof entry?.sourceHash === 'string' ? entry.sourceHash : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True only for an unmodified app-seeded factory copy: a shipped schema-1 factory example, or the
 * exact bytes Desktop recorded seeding. Any operator edit changes the digest and returns false.
 */
export function isUnmodifiedFactorySnapshot(source: string, configDirectory: string): boolean {
  if (LEGACY_FACTORY_EXAMPLE_DIGESTS.has(sha256(normalizeLineEndings(source)))) return true;
  const seeded = readDesktopSeedHash(configDirectory);
  return seeded !== undefined && seeded === sha256(source);
}
