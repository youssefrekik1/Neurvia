"use client";
import { useSyncExternalStore } from "react";
import { Courses, Progress, StudentQuiz, Tasks } from "./Student";
import {
  LessonDetail,
  LessonEditor,
  TeacherLessons,
  TeacherQuiz,
} from "./Teacher";
import { useLearning } from "./service";
import "./learning.css";

const subscribeQuery = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
export default function Learning({
  path,
  classroom,
}: {
  path: string;
  classroom: string;
}) {
  const data = useLearning();
  const query = useSyncExternalStore(
    subscribeQuery,
    () => window.location.search,
    () => "",
  );
  const params = new URLSearchParams(
    path.includes("?") ? path.split("?")[1] : query,
  );
  const route = path.split("?")[0].replace(/\/+$/, "");
  const props = { classroom, data };
  let view;
  if (route === "/teacher/lessons/new") {
    const existing = data.lessons.find(
      (l) => l.id === params.get("edit") && l.status === "draft",
    );
    view = (
      <LessonEditor
        key={existing?.id || classroom}
        classroom={classroom}
        existing={existing}
      />
    );
  } else if (route.startsWith("/teacher/lessons/")) {
    view = (
      <LessonDetail
        lesson={data.lessons.find((l) => l.id === route.split("/").pop())}
        published={params.get("published") === "1"}
      />
    );
  } else if (route === "/teacher/quiz") {
    const id = params.get("lesson");
    const lesson = id
      ? data.lessons.find((l) => l.id === id)
      : data.lessons.find(
          (l) => l.classroom === classroom && l.status === "draft",
        );
    view = (
      <TeacherQuiz
        key={(lesson?.id || "") + "-" + params.get("step")}
        lesson={lesson}
        step={params.get("step")}
        classroom={classroom}
      />
    );
  } else if (route === "/student/quiz")
    view = <StudentQuiz {...props} params={params} />;
  else if (route === "/student/tasks") view = <Tasks {...props} />;
  else if (route === "/student/progress") view = <Progress {...props} />;
  else if (route.startsWith("/student/courses"))
    view = (
      <Courses
        {...props}
        course={params.get("course") || route.split("/")[3] || null}
        lessonId={params.get("lesson")}
      />
    );
  else view = <TeacherLessons {...props} />;
  return (
    <div className="lr-workspace" key={classroom}>
      {view}
    </div>
  );
}
