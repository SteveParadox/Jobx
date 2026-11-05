declare module 'robots-parser' {
  type RobotsRules = {
    getCrawlDelay(userAgent?: string): number | undefined;
    isAllowed(url: string, userAgent?: string): boolean | undefined;
  };
  export default function robotsParser(robotsUrl: string, content: string): RobotsRules;
}
