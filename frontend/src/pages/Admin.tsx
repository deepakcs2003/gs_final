import { useState, useEffect, type ComponentType } from 'react';
import { Activity, BarChart3, ChevronRight, ClipboardList, CreditCard, DatabaseBackup, FolderTree, GalleryHorizontalEnd, Gauge, Globe2, Image, LayoutDashboard, LifeBuoy, Package, RefreshCw, Scissors, Settings, ShieldCheck, SlidersHorizontal, Star, Store, Truck, Users, Wallet } from 'lucide-react';
import { useCurrentUser } from '../hooks/queries';
import { OverviewModule } from './admin/Overview';
import { ProductsModule } from './admin/Products';
import { CatalogModule } from './admin/Catalog';
import { OrdersModule } from './admin/Orders';
import { TailorsModule } from './admin/Tailors';
import { CustomersModule } from './admin/Customers';
import { InventoryModule } from './admin/Inventory';
import { MeasurementsModule } from './admin/Measurements';
import { ReviewsModule } from './admin/Reviews';
import { CouponsModule } from './admin/Coupons';
import { BannersModule } from './admin/Banners';
import { HomepageModule } from './admin/Homepage';
import { AnalyticsModule } from './admin/Analytics';
import { EnquiriesModule } from './admin/Enquiries';
import { SeoModule } from './admin/Seo';
import { ShippingModule } from './admin/Shipping';
import { PaymentsModule } from './admin/Payments';
import { ContentModule } from './admin/Content';
import { AdminUsersModule } from './admin/AdminUsers';
import { SettingsModule } from './admin/Settings';
import { ActivityModule } from './admin/Activity';
import { BackupModule } from './admin/Backup';

const nav = {
  overview: { label: 'Overview', icon: LayoutDashboard },
  orders: { label: 'Orders', icon: ClipboardList },
  tailors: { label: 'Tailors & production', icon: Scissors },
  customers: { label: 'Customers', icon: Users },
  inventory: { label: 'Inventory & stock', icon: Gauge },
  measurements: { label: 'Measurements', icon: SlidersHorizontal },
  reviews: { label: 'Reviews', icon: Star },
  products: { label: 'Products', icon: Package },
  catalog: { label: 'Categories & colours', icon: FolderTree },
  coupons: { label: 'Coupons & offers', icon: CreditCard },
  homepage: { label: 'Homepage sections', icon: GalleryHorizontalEnd },
  banners: { label: 'Banners', icon: Image },
  analytics: { label: 'Analytics', icon: BarChart3 },
  notifications: { label: 'WhatsApp enquiries', icon: LifeBuoy },
  seo: { label: 'SEO manager', icon: Globe2 },
  shipping: { label: 'Shipping & delivery', icon: Truck },
  payments: { label: 'Payments', icon: Wallet },
  content: { label: 'Website content', icon: Store },
  'admin-users': { label: 'Admin users & roles', icon: ShieldCheck },
  settings: { label: 'Website settings', icon: Settings },
  activity: { label: 'Activity log', icon: Activity },
  backup: { label: 'Backup & export', icon: DatabaseBackup },
} as const;

const navOrder = [
  'overview', 'orders', 'tailors', 'customers', 'inventory', 'measurements', 'reviews',
  'products', 'catalog', 'coupons', 'homepage', 'banners',
  'analytics', 'notifications', 'seo',
  'shipping', 'payments', 'content', 'admin-users', 'settings', 'activity', 'backup',
] as const;

const navGroups: Array<{ label: string; items: Array<keyof typeof nav> }> = [
  { label: 'Command centre', items: ['overview', 'orders', 'tailors', 'customers', 'inventory', 'measurements', 'reviews'] },
  { label: 'Store & catalogue', items: ['products', 'catalog', 'coupons', 'homepage', 'banners'] },
  { label: 'Growth', items: ['analytics', 'notifications', 'seo'] },
  { label: 'Governance', items: ['shipping', 'payments', 'content', 'admin-users', 'settings', 'activity', 'backup'] },
];

const modules: Record<string, ComponentType<Record<string, unknown>>> = {
  overview: OverviewModule,
  orders: OrdersModule,
  tailors: TailorsModule,
  customers: CustomersModule,
  inventory: InventoryModule,
  measurements: MeasurementsModule,
  reviews: ReviewsModule,
  products: ProductsModule,
  catalog: CatalogModule,
  coupons: CouponsModule,
  homepage: HomepageModule,
  banners: BannersModule,
  analytics: AnalyticsModule,
  notifications: EnquiriesModule,
  seo: SeoModule,
  shipping: ShippingModule,
  payments: PaymentsModule,
  content: ContentModule,
  'admin-users': AdminUsersModule,
  settings: SettingsModule,
  activity: ActivityModule,
  backup: BackupModule,
};

export function AdminPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const [tab, setTab] = useState<keyof typeof nav>('overview');
  const [ordersFilter, setOrdersFilter] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [productTarget, setProductTarget] = useState<string | null>(null);
  const [customerTarget, setCustomerTarget] = useState<string | null>(null);

  const resetDeepLink = () => {
    setOrdersFilter(null);
    setOrderNumber(null);
    setProductTarget(null);
    setCustomerTarget(null);
  };

  useEffect(() => {
    const onOrders = (e: Event) => {
      const detail = (e as CustomEvent<{ filter?: string; orderNumber?: string }>).detail;
      setOrdersFilter(detail?.filter ?? 'ALL');
      setOrderNumber(detail?.orderNumber ?? null);
      setProductTarget(null);
      setCustomerTarget(null);
      setTab('orders');
    };
    const onProducts = (e: Event) => {
      const detail = (e as CustomEvent<{ productId: string }>).detail;
      if (!detail?.productId) return;
      setProductTarget(detail.productId);
      setOrdersFilter(null);
      setOrderNumber(null);
      setCustomerTarget(null);
      setTab('products');
    };
    const onCustomers = (e: Event) => {
      const detail = (e as CustomEvent<{ customerId: string }>).detail;
      if (!detail?.customerId) return;
      setCustomerTarget(detail.customerId);
      setOrdersFilter(null);
      setOrderNumber(null);
      setProductTarget(null);
      setTab('customers');
    };
    window.addEventListener('admin-nav-orders', onOrders);
    window.addEventListener('admin-nav-products', onProducts);
    window.addEventListener('admin-nav-customers', onCustomers);
    return () => {
      window.removeEventListener('admin-nav-orders', onOrders);
      window.removeEventListener('admin-nav-products', onProducts);
      window.removeEventListener('admin-nav-customers', onCustomers);
    };
  }, []);

  if (userLoading) return <div className="grid min-h-dvh place-items-center bg-cream text-ink-muted">Loading admin...</div>;
  if (!user?.isAdmin) return (
    <div className="grid min-h-dvh place-items-center bg-cream p-6">
      <div className="card max-w-md p-8 text-center">
        <ShieldCheck className="mx-auto text-maroon-600" size={40} />
        <h1 className="mt-4 font-display text-3xl font-bold">Admin login required</h1>
        <p className="mt-3 text-ink-muted">Please login with an authorised staff mobile number.</p>
      </div>
    </div>
  );

  const item = nav[tab];
  const Icon = item.icon;
  const ActiveModule = modules[tab];

  return (
    <div className="min-h-dvh bg-[#f7f3ed] text-ink lg:flex">
      <aside className="hidden w-72 shrink-0 border-r border-maroon-100 bg-[#3c1820] p-5 text-white lg:flex lg:flex-col">
        <div className="border-b border-white/15 pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-marigold-400">Guddi Silai</p>
          <h1 className="mt-2 font-display text-2xl font-bold">Control room</h1>
        </div>
        <nav className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((id) => {
                  const GroupIcon = nav[id].icon;
                  return (
                    <button key={id} type="button" onClick={() => { resetDeepLink(); setTab(id); }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition ${tab === id ? 'bg-marigold-500 text-ink' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                      <GroupIcon size={17} />{nav[id].label}<ChevronRight className="ml-auto" size={14} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-4 rounded-xl bg-white/10 p-3 text-sm">
          <p className="font-semibold">{user.name || 'Staff admin'}</p>
          <p className="mt-1 text-white/60">{user.mobile}</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-maroon-100 bg-[#f7f3ed]/95 px-4 py-4 backdrop-blur sm:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-maroon-600">Guddi Silai / Admin</p>
              <h2 className="font-display text-2xl font-bold">{item.label}</h2>
            </div>
            <button className="btn-outline px-3" onClick={() => window.location.reload()} title="Refresh data">
              <RefreshCw size={17} /><span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {navOrder.map((id) => (
              <button key={id} onClick={() => { resetDeepLink(); setTab(id); }} className={`chip whitespace-nowrap ${tab === id ? 'chip-active' : ''}`}>{nav[id].label}</button>
            ))}
          </div>
        </header>

        <div className="mx-auto max-w-7xl p-4 sm:p-8">
          {ActiveModule ? (
            <ActiveModule
              key={
                tab === 'orders' ? `orders|${ordersFilter ?? 'ALL'}|${orderNumber ?? ''}`
                  : tab === 'products' ? `products|${productTarget ?? ''}`
                  : tab === 'customers' ? `customers|${customerTarget ?? ''}`
                  : 'default'
              }
              {...(tab === 'orders' ? {
                initialFilter: ordersFilter ?? 'ALL',
                initialOrderNumber: orderNumber ?? undefined,
              } : {})}
              {...(tab === 'products' ? { initialProductId: productTarget ?? undefined } : {})}
              {...(tab === 'customers' ? { initialCustomerId: customerTarget ?? undefined } : {})}
            />
          ) : (
            <section className="card overflow-hidden">
              <div className="border-b border-maroon-100 bg-white p-6 sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-maroon-50 text-maroon-700"><Icon size={23} /></div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-maroon-600">Module workspace</p>
                    <h3 className="mt-1 font-display text-2xl font-bold">{item.label}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">Manage this part of your storefront from the admin panel.</p>
                  </div>
                </div>
              </div>
              <div className="p-6 text-sm text-ink-muted">This module is being built — the server contract is ready, the screen is coming next.</div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}