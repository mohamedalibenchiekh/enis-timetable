import Guide from './guide';
import guide from '../../generated/guide.json';

export const dynamic = 'force-static';

export default function HelpPage() {
  return <Guide html={guide.html} version={guide.version} />;
}
