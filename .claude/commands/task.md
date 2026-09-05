# /task - Task Management Command

Manage tasks for GitOps-based Kanban tracking. Tasks are stored in `data/tasks/` and can be visualized in Kanflow.

## Usage

```
/task create "Task title" [--type feature|bug|chore|spike] [--priority low|medium|high|critical]
/task list [--status todo|in_progress|done|blocked] [--type feature|bug|chore]
/task update <task-id> --status <new-status>
/task show <task-id>
/task delete <task-id>
```

## Actions

### Create Task
Create a new task in `data/tasks/`:

```yaml
# Generated: data/tasks/task-{id}.yaml
task_id: "task-001"
title: "Implement user authentication"
status: "todo"
priority: "high"
type: "feature"
```

### List Tasks
Display tasks filtered by status or type:

```
/task list --status in_progress
/task list --type bug
/task list  # All tasks
```

### Update Task Status
Progress a task through the workflow:

```
/task update task-001 --status in_progress
/task update task-001 --status done
```

### Show Task Details
View full task information including subtasks and provenance:

```
/task show task-001
```

## GitOps Flow

1. Tasks are YAML files in `data/tasks/`
2. Status changes update the YAML file
3. Kanflow polls/watches for changes
4. Dashboard reflects current state

## Integration with Dragonfly Workflow

Tasks can link to Dragonfly workflow artifacts:

```yaml
provenance:
  story_id: "story-001"
  architecture_id: "arch-001"
```

## Subtask Management

Add subtasks for granular progress tracking:

```
/task subtask task-001 add "Design API endpoints"
/task subtask task-001 complete sub-001
```

## Labels and Filtering

Add labels for organization:

```
/task label task-001 add "backend" "api"
/task list --label backend
```
