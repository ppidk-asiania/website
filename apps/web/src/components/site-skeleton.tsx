// Placeholders for <Suspense fallback> while a page's list loads. They reuse the real
// card/section classes so the page does not jump when the data arrives.
const Block = ({ className }: { className: string }) => (
  <div className={`site-skeleton ${className}`} />
);

const range = (count: number) => Array.from({ length: count }, (_, i) => i);

/** Filter bar (optional) and a grid of cards: events, news and gallery lists. */
export function CardsSkeleton({ count = 6, bar = false }: { count?: number; bar?: boolean }) {
  return (
    <div aria-hidden="true">
      {bar && <Block className="site-skeleton--bar" />}
      <ul className="site-cards">
        {range(count).map((i) => (
          <li key={i} className="site-card">
            <Block className="site-skeleton--image" />
            <Block className="site-skeleton--line site-skeleton--short" />
            <Block className="site-skeleton--line" />
            <Block className="site-skeleton--line" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Heading and three cards: the latest news and events on the home page. */
export function HomeCardsSkeleton() {
  return (
    <section className="home-section" aria-hidden="true">
      <Block className="site-skeleton--heading" />
      <ul className="home-cards">
        {range(3).map((i) => (
          <li key={i} className="home-card">
            <Block className="site-skeleton--line" />
            <Block className="site-skeleton--line" />
            <Block className="site-skeleton--line site-skeleton--short" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Plain rows: highlights, activities and the chapter list. */
export function LinesSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div aria-hidden="true">
      {range(lines).map((i) => (
        <Block key={i} className="site-skeleton--line" />
      ))}
    </div>
  );
}
