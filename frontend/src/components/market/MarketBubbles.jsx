import MarketDock from './MarketDock';

/**
 * Backward compatibility wrapper forwarding directly to MarketDock.
 */
export default function MarketBubbles(props) {
  return <MarketDock {...props} />;
}
