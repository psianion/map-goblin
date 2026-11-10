/** Wires canvas-specific implementations into @dnd/core's injectable slots. */
import { setNotify } from '@dnd/core/src/store/notify';
import { setMapDBFactory, setMapSerializer } from '@dnd/core/src/store/mapIO';
import { notify } from '@dnd/ui/toast';
import { MapIndexDB } from '@/io/mapIndexDB';
import { serializeToBytes, deserializeFromBytes } from '@/io/saveLoad';

setNotify(notify);
setMapDBFactory(() => new MapIndexDB());
setMapSerializer({ serializeToBytes, deserializeFromBytes });
