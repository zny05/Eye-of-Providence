import Image from "next/image";

export const metadata = { title: 'Who are you' };

export default function WhoAreYouPage() {
    return (
        <div className="workspace-inner">
            <header className="page-head">
                <div>
                    <h1 className="page-title flex items-center gap-2">
                        <Image src="/assets/images/who-are-you.png" alt="Who are you" width={26} height={17} />
                        Who are you
                    </h1>
                    <p className="page-sub">
                        Privacy self-check: what websites can read about you the moment you open a page — your likely
                        nationality, city, device, browser, screen, graphics card, network, preferences, fonts, and
                        browser fingerprint — plus checks that spot a VPN, proxy or spoofed browser.
                    </p>
                </div>
            </header>
            <div className="flex-1 min-h-0 w-full overflow-hidden rounded-[12px] border border-line shadow-sm bg-canvas">
                <iframe
                    src="/who-are-you/index.html?embed=1"
                    className="w-full h-full border-0"
                    title="Who are you — privacy self-check"
                    allow="geolocation"
                />
            </div>
        </div>
    );
}
