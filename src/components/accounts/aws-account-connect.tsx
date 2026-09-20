"use client";

import { Alert, Badge, Button, Input, Field, Skeleton } from "@/components/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  addAwsAccount,
  importAwsProfile,
  listAwsProfilesAction,
  type AwsAccountFormState,
  type AwsProfileInfo,
} from "@/server/actions/accounts";
import { CheckCircle2, HelpCircle, KeyRound, RefreshCw, Terminal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CodeBlock, CodePill, ConnectField, ConnectPanel, ConnectSelect, EncryptedNote, Note, RICH, Step, SubmitButton } from "./connect-shared";

const REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1",
  "ap-northeast-1", "ap-southeast-1", "ap-southeast-2", "ap-south-1",
];
const REGION_OPTIONS = REGIONS.map((r) => ({ value: r, label: r }));

export function AwsAccountConnect() {
  const t = useTranslations("cloud.connect.aws");
  return (
    <Tabs defaultValue="cli" className="w-full">
      <TabsList className="grid h-auto w-full grid-cols-1 sm:h-9 sm:grid-cols-3">
        <TabsTrigger value="cli">
          <Terminal className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.cli")}
        </TabsTrigger>
        <TabsTrigger value="keys">
          <KeyRound className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.keys")}
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.help")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="cli">
        <CliProfilesPanel />
      </TabsContent>
      <TabsContent value="keys">
        <AwsAccessKeysForm />
      </TabsContent>
      <TabsContent value="help">
        <GuidedSetupPanel />
      </TabsContent>
    </Tabs>
  );
}

function CliProfilesPanel() {
  const t = useTranslations("cloud.connect.aws.cli");
  const [loading, setLoading] = useState(true);
  const [cliInstalled, setCliInstalled] = useState(true);
  const [profiles, setProfiles] = useState<AwsProfileInfo[]>([]);
  const [refreshing, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      setLoading(true);
      const r = await listAwsProfilesAction();
      setCliInstalled(r.cliInstalled);
      setProfiles(r.profiles);
      setLoading(false);
    });
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scan once on mount
  }, []);

  return (
    <ConnectPanel
      title={t("title")}
      description={t.rich("description", RICH)}
      action={
        <Button variant="ghost" size="icon" onClick={refresh} loading={refreshing} aria-label={t("refresh")}>
          <RefreshCw className="size-4" aria-hidden />
        </Button>
      }
    >
      {loading ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !cliInstalled ? (
        <NoCliWarning />
      ) : profiles.length === 0 ? (
        <NoProfilesWarning />
      ) : (
        <ul className="divide-y divide-border">
          {profiles.map((p) => (
            <ProfileRow key={p.name} profile={p} />
          ))}
        </ul>
      )}
    </ConnectPanel>
  );
}

function ProfileRow({ profile }: { profile: AwsProfileInfo }) {
  const t = useTranslations("cloud.connect.aws.cli");
  const tp = useTranslations("cloud.shared.provider");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile.name === "default" ? t("defaultProfileName") : profile.name);
  const [region, setRegion] = useState(profile.region ?? "us-east-1");
  const [state, action, pending] = useActionState(importAwsProfile, {} as AwsAccountFormState);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      toast.success(t("imported", { name: profile.name }));
      router.push("/");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, profile.name, router, t]);

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-bg-muted" aria-hidden>
          <Terminal className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{profile.name}</span>
            {profile.isSso && <Badge variant="info">SSO</Badge>}
            {profile.hasStaticKeys && <Badge variant="muted">{t("staticKeys")}</Badge>}
            {profile.region && <span className="text-xs text-muted">· {profile.region}</span>}
          </div>
          {profile.ssoStartUrl && <div className="truncate text-xs text-muted">{profile.ssoStartUrl}</div>}
        </div>
        <Button variant={open ? "ghost" : "secondary"} size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? tc("cancel") : t("import")}
        </Button>
      </div>

      {open && (
        <form action={action} className="mt-3 grid gap-3 rounded-[var(--radius-md)] bg-bg-muted p-3 sm:grid-cols-2">
          <input type="hidden" name="profile" value={profile.name} />
          <Field label={t("displayName")}>
            <Input id={`name-${profile.name}`} name="name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ConnectSelect name="region" label={t("defaultRegion")} value={region} onValueChange={setRegion} options={REGION_OPTIONS} />
          {profile.isSso && !profile.hasStaticKeys && (
            <div className="sm:col-span-2">
              <Alert tone="warning">
                {t.rich("ssoLoginFirst", { ...RICH, cmd: () => <CodePill text={`aws sso login --profile ${profile.name}`} /> })}
              </Alert>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" loading={pending} className="w-full">
              <CheckCircle2 className="size-4" aria-hidden /> {pending ? t("verifying", { provider: tp("aws") }) : t("verifyImport")}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function NoCliWarning() {
  const t = useTranslations("cloud.connect.aws.cli.noCli");
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-border p-6 text-sm">
      <Alert tone="warning" title={t("title")}>
        <div className="space-y-3">
          <p>{t.rich("body", RICH)}</p>
          <div className="space-y-1.5">
            <CodeBlock label={t("winget")} code="winget install -e --id Amazon.AWSCLI" />
            <CodeBlock label={t("brew")} code="brew install awscli" />
          </div>
          <p className="text-xs">
            {t.rich("after", {
              ...RICH,
              configure: () => <CodePill text="aws configure" />,
              sso: () => <CodePill text="aws configure sso" />,
            })}
          </p>
        </div>
      </Alert>
    </div>
  );
}

function NoProfilesWarning() {
  const t = useTranslations("cloud.connect.aws.cli.noProfiles");
  return (
    <div className="space-y-3 rounded-[var(--radius-md)] border border-dashed border-border p-6 text-sm">
      <p className="font-medium">{t("title")}</p>
      <p className="text-muted">{t("body")}</p>
      <CodeBlock label={t("staticLabel")} code="aws configure --profile vmui" />
      <CodeBlock label={t("ssoLabel")} code="aws configure sso --profile vmui-sso" />
    </div>
  );
}

export function AwsAccessKeysForm() {
  const t = useTranslations("cloud.connect.aws.keys");
  const tp = useTranslations("cloud.shared.provider");
  const [state, action, pending] = useActionState(addAwsAccount, {} as AwsAccountFormState);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      toast.success(t("connected"));
      router.push("/");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router, t]);

  return (
    <ConnectPanel title={t("title")} description={<EncryptedNote />}>
      <form action={action} className="space-y-4">
        <ConnectField label={t("name")} name="name" placeholder={t("namePlaceholder")} hint={t("nameHint")} error={state.fieldErrors?.name} />
        <ConnectField label={t("accessKeyId")} name="accessKeyId" placeholder="AKIA…" autoComplete="off" hint={t("accessKeyIdHint")} error={state.fieldErrors?.accessKeyId} />
        <ConnectField label={t("secretAccessKey")} name="secretAccessKey" type="password" autoComplete="off" hint={t("secretAccessKeyHint")} error={state.fieldErrors?.secretAccessKey} />
        <ConnectField label={t("sessionToken")} name="sessionToken" type="password" autoComplete="off" hint={t("sessionTokenHint")} />
        <DefaultRegionSelect error={state.fieldErrors?.defaultRegion} hint={t.rich("defaultRegionHint", RICH)} label={t("defaultRegion")} />
        <SubmitButton pending={pending} provider={tp("aws")} className="w-full" />
      </form>
    </ConnectPanel>
  );
}

function DefaultRegionSelect({ error, hint, label }: { error?: string; hint: React.ReactNode; label: React.ReactNode }) {
  const [region, setRegion] = useState("us-east-1");
  return <ConnectSelect name="defaultRegion" label={label} hint={hint} error={error} value={region} onValueChange={setRegion} options={REGION_OPTIONS} />;
}

function GuidedSetupPanel() {
  const t = useTranslations("cloud.connect.aws.guide");
  return (
    <div className="space-y-4">
      <ConnectPanel title={t("pick.title")} description={t("pick.description")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <PathCard title={t("pick.a.title")} subtitle={t("pick.a.subtitle")} steps={[t("pick.a.s1"), t("pick.a.s2"), t("pick.a.s3")]} color="primary" />
          <PathCard title={t("pick.b.title")} subtitle={t("pick.b.subtitle")} steps={[t("pick.b.s1"), t("pick.b.s2"), t("pick.b.s3")]} color="accent" />
        </div>
      </ConnectPanel>

      <ConnectPanel title={t("a.title")}>
        <div className="space-y-4">
          <Step n={1} title={t("a.step1.title")}>
            <p>
              {t.rich("a.step1.body", {
                ...RICH,
                link: (chunks: React.ReactNode) => (
                  <a href="https://console.aws.amazon.com/iam/home#/users" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </Step>
          <Step n={2} title={t("a.step2.title")}>
            <CodeBlock
              code={`aws iam create-user --user-name vmui-controller
aws iam attach-user-policy --user-name vmui-controller \\
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess
aws iam create-access-key --user-name vmui-controller`}
            />
            <p className="text-xs">{t.rich("a.step2.body", RICH)}</p>
          </Step>
          <Step n={3} title={t("a.step3.title")}>
            <div className="grid gap-2 sm:grid-cols-2">
              <SubStep label={t("a.step3.cliLabel")}>
                <CodeBlock code="aws configure --profile vmui" />
                <p>{t.rich("a.step3.cliBody", RICH)}</p>
              </SubStep>
              <SubStep label={t("a.step3.pasteLabel")}>
                <p>{t.rich("a.step3.pasteBody", RICH)}</p>
              </SubStep>
            </div>
          </Step>
          <Note>{t.rich("a.note", RICH)}</Note>
        </div>
      </ConnectPanel>

      <ConnectPanel title={t("b.title")}>
        <div className="space-y-4">
          <Step n={1} title={t("b.step1.title")}>
            <CodeBlock code="aws configure sso --profile vmui-sso" />
            <p className="text-xs">{t.rich("b.step1.body", RICH)}</p>
          </Step>
          <Step n={2} title={t("b.step2.title")}>
            <CodeBlock code="aws sso login --profile vmui-sso" />
            <p className="text-xs">{t("b.step2.body")}</p>
          </Step>
          <Step n={3} title={t("b.step3.title")}>
            <p>{t.rich("b.step3.body", { ...RICH, badge: (chunks: React.ReactNode) => <Badge variant="info">{chunks}</Badge> })}</p>
          </Step>
          <Note>{t("b.note")}</Note>
        </div>
      </ConnectPanel>

      <ConnectPanel title={t("perms.title")}>
        <div className="space-y-2 text-sm">
          <p className="text-muted">{t("perms.full")}</p>
          <CodeBlock code="arn:aws:iam::aws:policy/AmazonEC2FullAccess" />
          <p className="text-muted">{t("perms.least")}</p>
          <CodeBlock
            code={`ec2:DescribeInstances
ec2:DescribeRegions
ec2:DescribeImages
ec2:DescribeHosts
ec2:RunInstances
ec2:StartInstances
ec2:StopInstances
ec2:RebootInstances
ec2:TerminateInstances
ec2:AllocateHosts          # only if you launch macOS
ec2:CreateTags
sts:GetCallerIdentity`}
          />
        </div>
      </ConnectPanel>
    </div>
  );
}

function PathCard({ title, subtitle, steps, color }: { title: string; subtitle: string; steps: string[]; color: "primary" | "accent" }) {
  return (
    <div
      className={cn(
        "surface p-4",
        color === "primary"
          ? "border-[color-mix(in_oklch,var(--color-primary)_35%,var(--color-border))]"
          : "border-[color-mix(in_oklch,var(--color-accent)_35%,var(--color-border))]",
      )}
    >
      <div className={cn("text-xs font-medium uppercase tracking-wider", color === "primary" ? "text-primary" : "text-accent")}>{title}</div>
      <div className="mt-1 font-semibold">{subtitle}</div>
      <ul className="mt-3 space-y-1 text-xs text-muted">
        {steps.map((s, i) => (
          <li key={i}>· {s}</li>
        ))}
      </ul>
    </div>
  );
}

function SubStep({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border p-3">
      <div className="mb-2 text-xs font-medium text-fg">{label}</div>
      <div className="space-y-2 text-xs text-muted">{children}</div>
    </div>
  );
}
