// Props every test-page panel gets: the one engine and its web drivers (issue #9).
import type { HapticOutputs } from '@/haptics/haptics';

export interface TestPanelProps {
  haptics: HapticOutputs;
}
