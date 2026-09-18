import { useParams } from 'react-router-dom';
import { ProductCardView } from '../components/product/ProductCard';
import { useCollection, useConfig } from '../hooks/queries';
import { ProductCard } from '../lib/types';

export function CollectionPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: config } = useConfig();
  const { data, isLoading, error } = useCollection(slug);

  const currency = config?.currency ?? 'INR';
  const products = (data?.products ?? []) as ProductCard[];
  const collection = data?.collection;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-52 rounded bg-maroon-100" />
          <div className="h-4 w-80 rounded bg-ink-light/10" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-80 rounded-xl bg-ink-light/10" />)}</div>
        </div>
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-3xl font-bold text-ink">Collection nahi mila</h1>
        <p className="mt-3 text-ink-muted">Ye link valid nahi hai ya collection archived ho chuka hai.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 rounded-3xl border border-maroon-100 bg-white p-6 shadow-card">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-maroon-600">Curated collection</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">{collection.title}</h1>
        {collection.description ? <p className="mt-3 max-w-2xl text-ink-muted">{collection.description}</p> : null}
        <p className="mt-4 text-sm text-ink-muted">{collection.productCount} products</p>
      </header>

      {products.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-muted">Iss collection mein abhi koi product available nahi hai.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {products.map((product) => (
            <ProductCardView key={product.id} product={product} currency={currency} />
          ))}
        </div>
      )}
    </div>
  );
}
