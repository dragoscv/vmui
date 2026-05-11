package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"text/tabwriter"
	"time"
)

const defaultBaseURL = "http://127.0.0.1:3737"
const version = "0.1.0"

type instance struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Provider           string  `json:"provider"`
	Region             string  `json:"region"`
	InstanceType       string  `json:"instanceType"`
	Status             string  `json:"status"`
	PublicIP           *string `json:"publicIp,omitempty"`
	PrivateIP          *string `json:"privateIp,omitempty"`
	Platform           string  `json:"platform"`
	ProviderInstanceID string  `json:"providerInstanceId"`
}

type client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func newClient() *client {
	base := os.Getenv("VMUI_URL")
	if base == "" {
		base = defaultBaseURL
	}
	key := os.Getenv("VMUI_API_KEY")
	return &client{
		baseURL: strings.TrimRight(base, "/"),
		apiKey:  key,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *client) do(method, path string, body any, out any) error {
	if c.apiKey == "" {
		return fmt.Errorf("VMUI_API_KEY is not set. Generate one in Settings → API keys.")
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.baseURL+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		var apiErr struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &apiErr)
		if apiErr.Error != "" {
			return fmt.Errorf("api %d: %s", resp.StatusCode, apiErr.Error)
		}
		return fmt.Errorf("api %d: %s", resp.StatusCode, string(raw))
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

func usage() {
	fmt.Fprintf(os.Stderr, `vmui-cli %s — control plane for local-first multi-cloud VMs

Usage:
  vmui-cli list                          List all known instances
  vmui-cli start    <id>                 Start an instance
  vmui-cli stop     <id>                 Stop an instance
  vmui-cli reboot   <id>                 Reboot an instance
  vmui-cli snapshot <id> [-label LABEL]  Snapshot the boot disk
  vmui-cli terminate <id>                Terminate (destructive!)
  vmui-cli backups policies              List backup policies
  vmui-cli backups jobs [-limit N]       List recent backup jobs
  vmui-cli gitops sources                List GitOps sources
  vmui-cli secrets                       List secret metadata (no values)
  vmui-cli audit [-q TERM] [-limit N]    Search the audit log

Env:
  VMUI_URL       Base URL of the vmui app (default %s)
  VMUI_API_KEY   API key with at least operator role
`, version, defaultBaseURL)
}

func cmdList(c *client) error {
	var rows []instance
	if err := c.do("GET", "/api/v1/instances", nil, &rows); err != nil {
		return err
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tPROVIDER\tREGION\tTYPE\tSTATUS\tIP")
	for _, r := range rows {
		ip := ""
		if r.PublicIP != nil && *r.PublicIP != "" {
			ip = *r.PublicIP
		} else if r.PrivateIP != nil && *r.PrivateIP != "" {
			ip = *r.PrivateIP
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			truncate(r.ID, 32), truncate(r.Name, 24), r.Provider, r.Region, r.InstanceType, r.Status, ip)
	}
	return w.Flush()
}

func cmdAction(c *client, action, id string) error {
	if id == "" {
		return fmt.Errorf("missing instance id")
	}
	var out struct {
		OK    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
	}
	if err := c.do("POST", fmt.Sprintf("/api/v1/instances/%s/%s", urlEsc(id), action), nil, &out); err != nil {
		return err
	}
	if !out.OK {
		return fmt.Errorf("%s", out.Error)
	}
	fmt.Printf("%s: ok\n", action)
	return nil
}

func cmdSnapshot(c *client, id, label string) error {
	if id == "" {
		return fmt.Errorf("missing instance id")
	}
	var out struct {
		OK         bool   `json:"ok"`
		Error      string `json:"error,omitempty"`
		SnapshotID string `json:"snapshotId,omitempty"`
		Note       string `json:"note,omitempty"`
	}
	body := map[string]string{}
	if label != "" {
		body["label"] = label
	}
	if err := c.do("POST", fmt.Sprintf("/api/v1/instances/%s/snapshot", urlEsc(id)), body, &out); err != nil {
		return err
	}
	if !out.OK {
		return fmt.Errorf("%s", out.Error)
	}
	fmt.Printf("snapshot: %s\n", out.SnapshotID)
	if out.Note != "" {
		fmt.Printf("note: %s\n", out.Note)
	}
	return nil
}

func cmdGenericList(c *client, path string, cols []string) error {
	var resp struct {
		OK    bool                     `json:"ok"`
		Items []map[string]interface{} `json:"items"`
	}
	if err := c.do("GET", path, nil, &resp); err != nil {
		return err
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	header := strings.Join(upperAll(cols), "\t")
	fmt.Fprintln(w, header)
	for _, row := range resp.Items {
		parts := make([]string, 0, len(cols))
		for _, col := range cols {
			parts = append(parts, fmt.Sprintf("%v", cellString(row[col])))
		}
		fmt.Fprintln(w, strings.Join(parts, "\t"))
	}
	return w.Flush()
}

func upperAll(s []string) []string {
	out := make([]string, len(s))
	for i, v := range s {
		out[i] = strings.ToUpper(v)
	}
	return out
}

func cellString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return truncate(x, 48)
	case float64:
		if x == float64(int64(x)) {
			return fmt.Sprintf("%d", int64(x))
		}
		return fmt.Sprintf("%g", x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", v)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

func urlEsc(s string) string {
	// Synthetic ids contain ':' which is safe in a path segment but encode
	// '/' and '#' just in case.
	r := strings.NewReplacer("/", "%2F", "#", "%23", " ", "%20")
	return r.Replace(s)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	c := newClient()
	cmd := os.Args[1]
	var err error
	switch cmd {
	case "list", "ls":
		err = cmdList(c)
	case "start", "stop", "reboot", "terminate":
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		err = cmdAction(c, cmd, os.Args[2])
	case "snapshot", "snap":
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		id := os.Args[2]
		fs := flag.NewFlagSet("snapshot", flag.ExitOnError)
		label := fs.String("label", "", "snapshot label")
		_ = fs.Parse(os.Args[3:])
		err = cmdSnapshot(c, id, *label)
	case "backups":
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		switch os.Args[2] {
		case "policies":
			err = cmdGenericList(c, "/api/v1/backups/policies", []string{"id", "name", "kind", "cronExpr", "lastStatus"})
		case "jobs":
			fs := flag.NewFlagSet("jobs", flag.ExitOnError)
			limit := fs.Int("limit", 20, "max rows")
			_ = fs.Parse(os.Args[3:])
			err = cmdGenericList(c, fmt.Sprintf("/api/v1/backups/jobs?limit=%d", *limit), []string{"id", "policyId", "status", "startedAt", "artifactRef"})
		default:
			usage()
			os.Exit(2)
		}
	case "gitops":
		if len(os.Args) < 3 || os.Args[2] != "sources" {
			usage()
			os.Exit(2)
		}
		err = cmdGenericList(c, "/api/v1/gitops/sources", []string{"id", "name", "url", "branch", "lastCommit", "lastError"})
	case "secrets":
		err = cmdGenericList(c, "/api/v1/secrets", []string{"id", "name", "kind", "rotationDays", "lastRotatedAt"})
	case "audit":
		fs := flag.NewFlagSet("audit", flag.ExitOnError)
		q := fs.String("q", "", "search term")
		limit := fs.Int("limit", 30, "max rows")
		_ = fs.Parse(os.Args[2:])
		path := fmt.Sprintf("/api/v1/audit?limit=%d", *limit)
		if *q != "" {
			path += "&q=" + urlEsc(*q)
		}
		err = cmdGenericList(c, path, []string{"id", "action", "target", "status", "message"})
	case "-h", "--help", "help":
		usage()
		return
	case "-v", "--version", "version":
		fmt.Println(version)
		return
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
