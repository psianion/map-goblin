/** Wires canvas-specific implementations into @dnd/core's injectable slots. */
import { setNotify } from '@dnd/core/src/store/notify';
import { setMapDBFactory, setMapSerializer } from '@dnd/core/src/store/mapIO';
import { setPackManagerFactory } from '@dnd/core/src/store/packIO';
import { notify } from '@/lib/toast';
import { MapIndexDB } from '@/io/mapIndexDB';
import { serializeToBytes, deserializeFromBytes } from '@/io/saveLoad';
import { getAssetPackManager } from '@/engine/assetPackInstance';

setNotify(notify);
setMapDBFactory(() => new MapIndexDB());
setMapSerializer({ serializeToBytes, deserializeFromBytes });
setPackManagerFactory(() => getAssetPackManager());
